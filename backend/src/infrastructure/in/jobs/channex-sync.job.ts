import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import {
  CHANNEX_SETUP_STATE,
  type ChannexSetupState,
} from '../../../application/ports/out/channex-setup-state.js';
import {
  PUBLISH_PENDING_NO_SHOWS,
  type PublishPendingNoShows,
} from '../../../application/use-cases/generate-ota-reservation/ports/in/publish-pending-no-shows.port.js';
import {
  PROCESS_BOOKING_FEED,
  type ProcessBookingFeed,
} from '../../../application/use-cases/generate-ota-reservation/ports/in/process-booking-feed.port.js';
import { AdvisoryLock } from './advisory-lock.js';

/** El nombre del temporizador en el `SchedulerRegistry`. */
export const CHANNEX_SYNC_INTERVAL = 'channex-sync';

/** El bloqueo asesor de la tarea (plan de `generate-ota-reservation`, punto 7). */
export const CHANNEX_SYNC_LOCK = 'channex-sync';

/**
 * La tarea de Channex (plan de `generate-ota-reservation`, puntos 7, 8 y 9): cada
 * `CHANNEX_SYNC_INTERVAL_SECONDS` corre el ciclo del feed (`ProcessBookingFeed`: repite los `ack` pendientes,
 * lee, procesa las revisiones y las confirma) y después envía los no-shows pendientes (A3), aunque la
 * lectura no haya podido leerlo: el reporte no depende del feed. Enviar la disponibilidad (`configure-ota`,
 * que va antes de los no-shows) se agrega en su tarea. No hace nada
 * mientras la configuración de Channex no esté lista, y corre con un bloqueo asesor para que dos
 * ejecuciones no se crucen.
 */
@Injectable()
export class ChannexSyncJob
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(ChannexSyncJob.name);

  constructor(
    @Inject(PROCESS_BOOKING_FEED)
    private readonly feed: ProcessBookingFeed,
    @Inject(PUBLISH_PENDING_NO_SHOWS)
    private readonly noShows: PublishPendingNoShows,
    @Inject(CHANNEX_SETUP_STATE)
    private readonly state: ChannexSetupState,
    private readonly lock: AdvisoryLock,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  /** Programa la tarea con el intervalo de la configuración; sin configuración válida, no la programa. */
  onApplicationBootstrap(): void {
    const seconds = this.state.settings()?.syncIntervalSeconds;
    if (seconds === undefined) {
      return;
    }
    this.scheduler.addInterval(
      CHANNEX_SYNC_INTERVAL,
      setInterval(() => void this.run(), seconds * 1_000),
    );
  }

  onApplicationShutdown(): void {
    if (this.scheduler.doesExist('interval', CHANNEX_SYNC_INTERVAL)) {
      this.scheduler.deleteInterval(CHANNEX_SYNC_INTERVAL);
    }
  }

  /**
   * Una ejecución. Devuelve `false` si no corrió: la configuración no está lista o hay otra ejecución en
   * curso. Un error inesperado se registra y no detiene las siguientes.
   */
  async run(): Promise<boolean> {
    if (!this.state.isReady()) {
      return false;
    }
    try {
      return await this.lock.runExclusive(CHANNEX_SYNC_LOCK, async () => {
        // T007: repite los ack pendientes, lee el feed, procesa las revisiones y confirma.
        await this.feed.run();
        await this.noShows.publish();
      });
    } catch (error) {
      this.logger.error(
        'El ciclo de Channex falló por un error inesperado: se intenta en el siguiente',
        error instanceof Error ? error.stack : String(error),
      );
      return false;
    }
  }
}
