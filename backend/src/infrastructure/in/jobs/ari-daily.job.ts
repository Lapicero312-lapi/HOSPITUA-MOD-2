import {
  type BeforeApplicationShutdown,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  CHANNEX_SETUP_STATE,
  type ChannexSetupState,
} from '../../../application/ports/out/channex-setup-state.js';
import {
  PUBLISH_DAILY_AVAILABILITY,
  type PublishDailyAvailability,
} from '../../../application/use-cases/configure-ota/ports/in/publish-daily-availability.port.js';
import {
  SYNC_ROOM_TYPES,
  type SyncRoomTypes,
} from '../../../application/use-cases/configure-ota/ports/in/sync-room-types.port.js';
import {
  PROCESS_BOOKING_FEED,
  type ProcessBookingFeed,
} from '../../../application/use-cases/generate-ota-reservation/ports/in/process-booking-feed.port.js';
import { AdvisoryLock } from './advisory-lock.js';
import { CHANNEX_SYNC_LOCK } from './channex-sync.job.js';
import { JOBS_TIME_ZONE } from './jobs-time-zone.js';

/** El nombre de la tarea en el `SchedulerRegistry`. */
export const ARI_DAILY_JOB = 'ari-daily';

/** Todos los días a las 03:00:00, en `JOBS_TIME_ZONE` (segundo, minuto, hora, día, mes, día de la semana). */
export const ARI_DAILY_CRON = '0 0 3 * * *';

/** Con el bloqueo ocupado, se reintenta cada 5 s, hasta 10 minutos (plan de `configure-ota`, B4). */
export const ARI_DAILY_LOCK_RETRY_MS = 5_000;
export const ARI_DAILY_LOCK_WAIT_MS = 10 * 60_000;

/**
 * El envío de las 03:00 (plan de `configure-ota`, regla 5 y B4, "Quién lo llama"; T011). Con el bloqueo de las
 * tareas de Channex (el de `ChannexSyncJob`, regla 7), corre en orden:
 * 1. el feed (`ProcessBookingFeed`);
 * 2. la sincronización de tipos (`SyncRoomTypes`, C1);
 * 3. la disponibilidad completa (`PublishDailyAvailability`), solo si el feed se leyó (FR-007); si no, sus
 *    noches quedan como marcas para `ChannexSyncJob` (`markAllPending`).
 *
 * Si el bloqueo está ocupado, lo reintenta cada 5 s hasta 10 minutos; si no lo consigue, anota las noches. No
 * hace nada mientras la configuración de Channex no esté lista, y no se recupera al arrancar: lo corrige el
 * envío del día siguiente.
 */
@Injectable()
export class AriDailyJob implements BeforeApplicationShutdown {
  private readonly logger = new Logger(AriDailyJob.name);

  /** La ejecución en curso, para esperarla al apagar. */
  private running: Promise<boolean> | null = null;

  /** La aplicación se está apagando: deja de esperar el bloqueo. */
  private stopping = false;

  constructor(
    @Inject(PROCESS_BOOKING_FEED)
    private readonly feed: ProcessBookingFeed,
    @Inject(SYNC_ROOM_TYPES)
    private readonly roomTypes: SyncRoomTypes,
    @Inject(PUBLISH_DAILY_AVAILABILITY)
    private readonly availability: PublishDailyAvailability,
    @Inject(CHANNEX_SETUP_STATE)
    private readonly state: ChannexSetupState,
    private readonly lock: AdvisoryLock,
  ) {}

  @Cron(ARI_DAILY_CRON, { name: ARI_DAILY_JOB, timeZone: JOBS_TIME_ZONE })
  async onSchedule(): Promise<void> {
    await this.run();
  }

  /** Deja de esperar el bloqueo y espera la ejecución en curso antes de que se cierre la conexión a la base. */
  async beforeApplicationShutdown(): Promise<void> {
    this.stopping = true;
    await this.running;
  }

  /**
   * Una ejecución. Devuelve `false` si no corrió: la configuración no está lista, el bloqueo siguió ocupado o
   * falló por un error inesperado, que se registra.
   */
  run(): Promise<boolean> {
    const execution = this.execute().finally(() => {
      if (this.running === execution) {
        this.running = null;
      }
    });
    this.running = execution;
    return execution;
  }

  private async execute(): Promise<boolean> {
    if (!this.state.isReady()) {
      return false;
    }
    try {
      const deadline = Date.now() + ARI_DAILY_LOCK_WAIT_MS;
      for (;;) {
        if (
          await this.lock.runExclusive(CHANNEX_SYNC_LOCK, () => this.cycle())
        ) {
          return true;
        }
        if (this.stopping || Date.now() + ARI_DAILY_LOCK_RETRY_MS > deadline) {
          break;
        }
        await delay(ARI_DAILY_LOCK_RETRY_MS);
      }
      this.logger.error(
        'El envío de las 03:00 no consiguió el bloqueo de Channex: sus noches quedan como marcas para el ciclo de 30 s.',
      );
      await this.availability.markAllPending();
      return false;
    } catch (error) {
      this.logger.error(
        'El envío de las 03:00 falló por un error inesperado: lo corrige el envío del día siguiente',
        error instanceof Error ? error.stack : String(error),
      );
      return false;
    }
  }

  /** Los tres pasos, con el bloqueo. */
  private async cycle(): Promise<void> {
    const feedRead = await this.step('el feed', () => this.feed.run());
    await this.step('los tipos de habitación', () => this.roomTypes.sync());
    if (feedRead === true) {
      await this.step('la disponibilidad completa', () =>
        this.availability.publish(),
      );
      return;
    }
    this.logger.warn(
      'No se envía la disponibilidad completa: el feed no se leyó. Sus noches quedan como marcas para el ciclo de 30 s.',
    );
    await this.step('las marcas de la disponibilidad completa', () =>
      this.availability.markAllPending(),
    );
  }

  /** Un paso: un error inesperado queda en el log, con su pila, y no impide los siguientes. */
  private async step<T>(
    name: string,
    work: () => Promise<T>,
  ): Promise<T | undefined> {
    try {
      return await work();
    } catch (error) {
      this.logger.error(
        `El paso del envío de las 03:00 "${name}" falló por un error inesperado`,
        error instanceof Error ? error.stack : String(error),
      );
      return undefined;
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
