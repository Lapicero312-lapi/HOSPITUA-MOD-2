import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AriChange } from '../../ports/out/ari-pending-change.repository.js';
import {
  CHANNEX_SETUP_STATE,
  type ChannexSetupState,
} from '../../ports/out/channex-setup-state.js';
import { CLOCK, type Clock } from '../../ports/out/clock.js';
import {
  PROCESSED_MESSAGE_REPOSITORY,
  type ProcessedMessageRepository,
} from '../../ports/out/processed-message.repository.js';
import {
  TRANSACTION_RUNNER,
  type Transaction,
  type TransactionRunner,
} from '../../ports/out/transaction.js';
import {
  ARI_CHANGE_RECORDER,
  type AriChangeRecorder,
} from './ports/in/ari-change-recorder.port.js';
import type {
  HandleMaintenanceNotice,
  MaintenanceNotice,
  MaintenanceNoticeOutcome,
} from './ports/in/handle-maintenance-notice.port.js';

/** Los días que se envían si la configuración de Channex no es válida (`CHANNEX_ARI_DAYS`, B0). */
const DEFAULT_ARI_DAYS = 90;

/**
 * E1 de `configure-ota` (T012b). Las marcas se dejan aunque Channex esté apagado: el envío
 * (`ChannexSyncJob`) no hace nada mientras no esté listo, y las envía cuando lo esté.
 */
@Injectable()
export class HandleMaintenanceNoticeService implements HandleMaintenanceNotice {
  private readonly logger = new Logger(HandleMaintenanceNoticeService.name);

  constructor(
    @Inject(TRANSACTION_RUNNER)
    private readonly transactions: TransactionRunner,
    @Inject(PROCESSED_MESSAGE_REPOSITORY)
    private readonly processedMessages: ProcessedMessageRepository,
    @Inject(ARI_CHANGE_RECORDER)
    private readonly availabilityChanges: AriChangeRecorder,
    @Inject(CHANNEX_SETUP_STATE)
    private readonly channex: ChannexSetupState,
    @Inject(CLOCK)
    private readonly clock: Clock,
  ) {}

  execute(notice: MaintenanceNotice): Promise<MaintenanceNoticeOutcome> {
    return this.transactions.run((tx) => this.process(tx, notice));
  }

  private async process(
    tx: Transaction,
    notice: MaintenanceNotice,
  ): Promise<MaintenanceNoticeOutcome> {
    const { messageId, queue, sequenceNumber, roomId } = notice;
    if (await this.processedMessages.isProcessed(messageId, tx)) {
      this.logger.log(
        `Aviso de mantenimiento repetido (habitación ${roomId}): ya se procesó y se confirma sin cambios.`,
      );
      return 'DUPLICATE';
    }
    const changes = this.changesOf(notice);
    if (changes.length > 0) {
      await this.availabilityChanges.record(tx, changes);
    }
    await this.processedMessages.record(
      { messageId, queue, sequenceNumber },
      tx,
    );
    return 'APPLIED';
  }

  /**
   * Las fechas del mantenimiento y, con `UPDATED`, las anteriores, como marcas de B2 (`dateTo` excluido:
   * el mantenimiento incluye su último día, así que la marca llega al día siguiente), recortadas a
   * `[hoy, hoy + CHANNEX_ARI_DAYS)`. Las que quedan fuera no se anotan.
   */
  private changesOf(notice: MaintenanceNotice): AriChange[] {
    const today = this.clock.today();
    const days = this.channex.settings()?.ariDays ?? DEFAULT_ARI_DAYS;
    const limit = addDays(today, days);
    const ranges = [
      { startDate: notice.startDate, endDate: notice.endDate },
      ...(notice.action === 'UPDATED' && notice.previous !== null
        ? [notice.previous]
        : []),
    ];
    const changes: AriChange[] = [];
    for (const { startDate, endDate } of ranges) {
      const dateFrom = startDate > today ? startDate : today;
      const exclusiveEnd = addDays(endDate, 1);
      const dateTo = exclusiveEnd < limit ? exclusiveEnd : limit;
      if (dateFrom < dateTo) {
        changes.push({ categoryRoom: notice.categoryRoom, dateFrom, dateTo });
      }
    }
    return changes;
  }
}

/** `date` (`AAAA-MM-DD`) más `days` días, sin zona horaria. */
function addDays(date: string, days: number): string {
  const time = Date.parse(`${date}T00:00:00Z`) + days * 86_400_000;
  return new Date(time).toISOString().slice(0, 10);
}
