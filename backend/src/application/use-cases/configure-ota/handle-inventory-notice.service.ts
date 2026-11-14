import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AriChange } from '../../ports/out/ari-pending-change.repository.js';
import {
  CHANNEX_SETUP_STATE,
  type ChannexSetupState,
} from '../../ports/out/channex-setup-state.js';
import { CLOCK, type Clock } from '../../ports/out/clock.js';
import {
  EXCLUSIVE_RUNNER,
  type ExclusiveRunner,
} from '../../ports/out/exclusive-runner.js';
import {
  PROCESSED_MESSAGE_REPOSITORY,
  type ProcessedMessageRepository,
} from '../../ports/out/processed-message.repository.js';
import {
  TRANSACTION_RUNNER,
  type Transaction,
  type TransactionRunner,
} from '../../ports/out/transaction.js';
import { CHANNEX_LOCK } from './channex-lock.js';
import {
  ARI_CHANGE_RECORDER,
  type AriChangeRecorder,
} from './ports/in/ari-change-recorder.port.js';
import {
  ChannexLockBusyError,
  type HandleInventoryNotice,
  type InventoryNotice,
  type InventoryNoticeOutcome,
} from './ports/in/handle-inventory-notice.port.js';
import {
  SYNC_ROOM_TYPES,
  type RoomTypeSync,
  type SyncRoomTypes,
} from './ports/in/sync-room-types.port.js';

/** Los días que se anotan si la configuración de Channex no es válida (`CHANNEX_ARI_DAYS`, B0). */
const DEFAULT_ARI_DAYS = 90;

/**
 * E2 de `configure-ota` (T012b). Las marcas se dejan aunque Channex no esté listo: el envío
 * (`ChannexSyncJob`) no hace nada mientras no lo esté, y las envía cuando lo esté.
 */
@Injectable()
export class HandleInventoryNoticeService implements HandleInventoryNotice {
  private readonly logger = new Logger(HandleInventoryNoticeService.name);

  constructor(
    @Inject(TRANSACTION_RUNNER)
    private readonly transactions: TransactionRunner,
    @Inject(PROCESSED_MESSAGE_REPOSITORY)
    private readonly processedMessages: ProcessedMessageRepository,
    @Inject(ARI_CHANGE_RECORDER)
    private readonly availabilityChanges: AriChangeRecorder,
    @Inject(SYNC_ROOM_TYPES)
    private readonly roomTypes: SyncRoomTypes,
    @Inject(EXCLUSIVE_RUNNER)
    private readonly lock: ExclusiveRunner,
    @Inject(CHANNEX_SETUP_STATE)
    private readonly channex: ChannexSetupState,
    @Inject(CLOCK)
    private readonly clock: Clock,
  ) {}

  async execute(notice: InventoryNotice): Promise<InventoryNoticeOutcome> {
    // Paso 1: un repetido no vuelve a sincronizar.
    const seen = await this.transactions.run((tx) =>
      this.processedMessages.isProcessed(notice.messageId, tx),
    );
    if (seen) {
      return this.duplicate(notice);
    }
    // Paso 2.
    await this.syncRoomTypes(notice);
    // Paso 3. Se revisa otra vez dentro de la transacción: otra entrega pudo atenderlo mientras tanto.
    return this.transactions.run((tx) => this.record(tx, notice));
  }

  /** Con el bloqueo de las tareas de Channex; sin Channex listo, no se sincroniza (como E1, solo marcas). */
  private async syncRoomTypes(notice: InventoryNotice): Promise<void> {
    if (!this.channex.isReady()) {
      return;
    }
    let result: RoomTypeSync | undefined;
    const ran = await this.lock.runExclusive(CHANNEX_LOCK, async () => {
      result = await this.roomTypes.sync();
    });
    if (!ran) {
      this.logger.warn(
        `Aviso de inventario (habitación ${notice.roomId}): otra tarea de Channex tiene el bloqueo; se reintenta.`,
      );
      throw new ChannexLockBusyError();
    }
    if (result?.status === 'NOT_SYNCED') {
      this.logger.warn(
        `Aviso de inventario (habitación ${notice.roomId}): los tipos de habitación no se sincronizaron (${result.reason}); se anotan las marcas igual y se corrigen a las 03:00.`,
      );
    }
  }

  private async record(
    tx: Transaction,
    notice: InventoryNotice,
  ): Promise<InventoryNoticeOutcome> {
    const { messageId, queue, sequenceNumber } = notice;
    if (await this.processedMessages.isProcessed(messageId, tx)) {
      return this.duplicate(notice);
    }
    await this.availabilityChanges.record(tx, this.changesOf(notice));
    await this.processedMessages.record(
      { messageId, queue, sequenceNumber },
      tx,
    );
    return 'APPLIED';
  }

  private duplicate(notice: InventoryNotice): InventoryNoticeOutcome {
    this.logger.log(
      `Aviso de inventario repetido (habitación ${notice.roomId}): ya se procesó y se confirma sin cambios.`,
    );
    return 'DUPLICATE';
  }

  /** `[hoy, hoy + CHANNEX_ARI_DAYS)` de la categoría y, si cambió, de la anterior (B2, `dateTo` excluido). */
  private changesOf(notice: InventoryNotice): AriChange[] {
    const dateFrom = this.clock.today();
    const days = this.channex.settings()?.ariDays ?? DEFAULT_ARI_DAYS;
    const dateTo = addDays(dateFrom, days);
    const categories = [notice.categoryRoom];
    if (
      notice.previousCategoryRoom !== null &&
      notice.previousCategoryRoom !== notice.categoryRoom
    ) {
      categories.push(notice.previousCategoryRoom);
    }
    return categories.map((categoryRoom) => ({
      categoryRoom,
      dateFrom,
      dateTo,
    }));
  }
}

/** `date` (`AAAA-MM-DD`) más `days` días, sin zona horaria. */
function addDays(date: string, days: number): string {
  const time = Date.parse(`${date}T00:00:00Z`) + days * 86_400_000;
  return new Date(time).toISOString().slice(0, 10);
}
