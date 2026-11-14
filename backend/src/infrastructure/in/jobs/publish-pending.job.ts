import {
  type BeforeApplicationShutdown,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  PUBLISH_PENDING_DAILY_MESSAGES,
  type PublishPendingDailyMessages,
} from '../../../application/use-cases/check-view-reservation/ports/in/publish-pending-daily-messages.port.js';
import { JOBS_TIME_ZONE } from './jobs-time-zone.js';

/** El nombre de la tarea en el `SchedulerRegistry`. */
export const PUBLISH_PENDING_JOB = 'daily-list-publish';

/** Cada 10 segundos (segundo, minuto, hora, día, mes, día de la semana). */
export const PUBLISH_PENDING_CRON = '*/10 * * * * *';

/**
 * El respaldo de la publicación de la lista del día y sus actualizaciones (plan de `check-view-reservation`,
 * "Publicación en orden" y "Quién lo llama (T029)"): cada 10 s llama a `PublishPendingDailyMessages`, que
 * publica en orden con el bloqueo `daily-list-publish`. Así salen los que no salieron en la publicación
 * inmediata (RabbitMQ caído, un reintento con espera o una ejecución que se cruzó).
 */
@Injectable()
export class PublishPendingJob implements BeforeApplicationShutdown {
  private readonly logger = new Logger(PublishPendingJob.name);

  /** La ejecución en curso, para esperarla al apagar. */
  private running: Promise<void> | null = null;

  constructor(
    @Inject(PUBLISH_PENDING_DAILY_MESSAGES)
    private readonly publication: PublishPendingDailyMessages,
  ) {}

  /** Espera la ejecución en curso antes de que se cierre la conexión a la base. */
  async beforeApplicationShutdown(): Promise<void> {
    await this.running;
  }

  @Cron(PUBLISH_PENDING_CRON, {
    name: PUBLISH_PENDING_JOB,
    timeZone: JOBS_TIME_ZONE,
  })
  async onSchedule(): Promise<void> {
    await this.run();
  }

  /**
   * Una ejecución. Nunca lanza: un error inesperado (por ejemplo, de la base de datos) queda en el log, sin
   * su texto, y la siguiente vuelve a intentar.
   */
  run(): Promise<void> {
    const execution = this.execute().finally(() => {
      if (this.running === execution) {
        this.running = null;
      }
    });
    this.running = execution;
    return execution;
  }

  private async execute(): Promise<void> {
    try {
      await this.publication.execute();
    } catch {
      // Sin el texto del error: no se exponen detalles de infraestructura.
      this.logger.error(
        'La publicación de la lista del día falló por un error inesperado: se intenta en la siguiente ejecución.',
      );
    }
  }
}
