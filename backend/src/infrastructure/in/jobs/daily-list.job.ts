import {
  type BeforeApplicationShutdown,
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  GENERATE_DAILY_LIST,
  type GenerateDailyList,
} from '../../../application/use-cases/check-view-reservation/ports/in/generate-daily-list.port.js';
import { AdvisoryLock } from './advisory-lock.js';
import { JOBS_TIME_ZONE } from './jobs-time-zone.js';

/** El nombre de la tarea en el `SchedulerRegistry`. */
export const DAILY_LIST_JOB = 'daily-list';

/** El bloqueo asesor de la tarea (plan base, C10; D2 del plan de `check-view-reservation`). */
export const DAILY_LIST_LOCK = 'daily-list';

/** Todos los días a las 00:00:00, en `JOBS_TIME_ZONE` (segundo, minuto, hora, día, mes, día de la semana). */
export const DAILY_LIST_CRON = '0 0 0 * * *';

/**
 * La lista del día para el Módulo 1 (plan de `check-view-reservation`, "Tareas programadas" y D2):
 * - a las 00:00 (`America/Bogota`) llama a `GenerateDailyList`;
 * - al arrancar hace lo mismo, para cubrir un reinicio o una caída a las 00:00. Como `GenerateDailyList`
 *   no hace nada si la lista del día ya está generada, arrancar varias veces no la duplica.
 *
 * Corre con un bloqueo asesor: si otra instancia lo tiene, se salta esa ejecución. Publicar la lista es
 * de T025, T026 y T029.
 */
@Injectable()
export class DailyListJob
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private readonly logger = new Logger(DailyListJob.name);

  /** La ejecución en curso, para esperarla al apagar. */
  private running: Promise<boolean> | null = null;

  constructor(
    @Inject(GENERATE_DAILY_LIST)
    private readonly generateDailyList: GenerateDailyList,
    private readonly lock: AdvisoryLock,
  ) {}

  /** La recuperación al arrancar. No bloquea el arranque. */
  onApplicationBootstrap(): void {
    void this.run();
  }

  /** Espera la ejecución en curso antes de que se cierre la conexión a la base. */
  async beforeApplicationShutdown(): Promise<void> {
    await this.running;
  }

  @Cron(DAILY_LIST_CRON, { name: DAILY_LIST_JOB, timeZone: JOBS_TIME_ZONE })
  async onSchedule(): Promise<void> {
    await this.run();
  }

  /**
   * Una ejecución. Devuelve `false` si no corrió porque otra la tiene bloqueada, o si falló. Un error
   * inesperado se registra y no detiene las siguientes: la próxima vez que arranque, o a las 00:00 del día
   * siguiente, se vuelve a intentar.
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
    try {
      return await this.lock.runExclusive(DAILY_LIST_LOCK, async () => {
        await this.generateDailyList.execute();
      });
    } catch (error) {
      this.logger.error(
        'La generación de la lista del día falló por un error inesperado',
        error instanceof Error ? error.stack : String(error),
      );
      return false;
    }
  }
}
