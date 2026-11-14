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
  PUBLISH_PENDING_AVAILABILITY,
  type PublishPendingAvailability,
} from '../../../application/use-cases/configure-ota/ports/in/publish-pending-availability.port.js';
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
 * La tarea de Channex (plan de `generate-ota-reservation`, puntos 7, 8 y 9, y B3 de `configure-ota`): cada
 * `CHANNEX_SYNC_INTERVAL_SECONDS` corre, en orden, el ciclo del feed (`ProcessBookingFeed`: repite los `ack`
 * pendientes, lee, procesa las revisiones y las confirma), el envío de la disponibilidad pendiente
 * (`PublishPendingAvailability`, T010) y el de los no-shows pendientes (A3). Si el feed falla por un error
 * inesperado, la disponibilidad no se envía en ese ciclo (FR-007: primero las reservas de Channex); los
 * no-shows, que no dependen del feed, sí. Cada error queda en el log. No hace nada
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
    @Inject(PUBLISH_PENDING_AVAILABILITY)
    private readonly availability: PublishPendingAvailability,
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
        const feedRead = await this.step('el feed', () => this.feed.run());
        // T010 de configure-ota: la disponibilidad pendiente, solo después de procesar el feed (FR-007).
        if (feedRead) {
          await this.step('la disponibilidad pendiente', () =>
            this.availability.publish(),
          );
        } else {
          this.logger.warn(
            'No se envía la disponibilidad en este ciclo: el feed no se procesó. Las marcas quedan para el siguiente.',
          );
        }
        await this.step('los no-shows', () => this.noShows.publish());
      });
    } catch (error) {
      this.logger.error(
        'El ciclo de Channex falló por un error inesperado: se intenta en el siguiente',
        error instanceof Error ? error.stack : String(error),
      );
      return false;
    }
  }

  /**
   * Un paso del ciclo: un error inesperado queda en el log, con su pila. Devuelve si terminó sin error, para
   * que quien sigue decida si puede correr.
   */
  private async step(
    name: string,
    work: () => Promise<unknown>,
  ): Promise<boolean> {
    try {
      await work();
      return true;
    } catch (error) {
      this.logger.error(
        `El paso de Channex "${name}" falló por un error inesperado: se intenta en el siguiente ciclo`,
        error instanceof Error ? error.stack : String(error),
      );
      return false;
    }
  }
}
