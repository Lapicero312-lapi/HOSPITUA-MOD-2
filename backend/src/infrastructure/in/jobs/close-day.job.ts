import {
  type BeforeApplicationShutdown,
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DateTime } from 'luxon';
import { CLOCK, type Clock } from '../../../application/ports/out/clock.js';
import {
  CLOSE_DAY,
  type CloseDay,
} from '../../../application/use-cases/update-reservation/ports/in/close-day.port.js';
import { AdvisoryLock } from './advisory-lock.js';
import { JOBS_TIME_ZONE } from './jobs-time-zone.js';

/** El nombre de la tarea en el `SchedulerRegistry`. */
export const CLOSE_DAY_JOB = 'close-day';

/** El bloqueo asesor de la tarea (plan base, C10; punto 14 del plan de `update-reservation`). */
export const CLOSE_DAY_LOCK = 'close-day';

/**
 * Todos los días a las 00:00:30, en `JOBS_TIME_ZONE` (segundo, minuto, hora, día, mes, día de la semana):
 * el cierre ocurre al terminar las 23:59 y procesa el día que terminó (plan base y FR-018).
 */
export const CLOSE_DAY_CRON = '30 0 0 * * *';

/**
 * El cierre del día (plan de `update-reservation`, D, D5 y punto 14; T022):
 * - a las 00:00:30 (`America/Bogota`) y al arrancar la aplicación (la recuperación) llama a
 *   `CloseDay.closePendingDays` con el día de hoy del `Clock`: cierra cada día anterior que quedó pendiente,
 *   del más antiguo al más reciente, nunca el de hoy;
 * - si la zona horaria del servidor no coincide con la del hotel, deja la alerta de negocio y sigue con la
 *   del hotel;
 * - si se pierde la base de datos, deja una alerta sin detalles de infraestructura y la siguiente
 *   ejecución completa lo que faltó.
 *
 * Corre con el bloqueo asesor `close-day`: si otra instancia lo tiene, se salta esa ejecución.
 */
@Injectable()
export class CloseDayJob
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private readonly logger = new Logger(CloseDayJob.name);

  /** La ejecución en curso, para esperarla al apagar. */
  private running: Promise<boolean> | null = null;

  constructor(
    @Inject(CLOSE_DAY)
    private readonly closeDay: CloseDay,
    @Inject(CLOCK)
    private readonly clock: Clock,
    private readonly lock: AdvisoryLock,
  ) {}

  /**
   * La recuperación al arrancar: el arranque la espera, como `DailyListJob`. No lo traba: `run()` no lanza
   * errores, y si otra instancia tiene el bloqueo se salta.
   */
  async onApplicationBootstrap(): Promise<void> {
    await this.run();
  }

  /** Espera la ejecución en curso antes de que se cierre la conexión a la base. */
  async beforeApplicationShutdown(): Promise<void> {
    await this.running;
  }

  @Cron(CLOSE_DAY_CRON, { name: CLOSE_DAY_JOB, timeZone: JOBS_TIME_ZONE })
  async onSchedule(): Promise<void> {
    await this.run();
  }

  /**
   * Una ejecución. Devuelve `false` si no corrió porque otra la tiene bloqueada, o si se detuvo por un
   * error. Nunca lanza: la próxima ejecución (al arrancar o a las 00:00:30) completa lo que faltó.
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
    this.alertIfServerTimeZoneDiffers(this.clock.now());
    // El día sale del `Clock`, que usa la zona del hotel aunque el servidor tenga otra.
    const today = this.clock.today();
    try {
      return await this.lock.runExclusive(CLOSE_DAY_LOCK, async () => {
        await this.closeDay.closePendingDays(today);
      });
    } catch {
      // Sin el texto del error: no se exponen detalles de infraestructura (caso borde del spec).
      this.logger.error(
        'El cierre del día se detuvo antes de terminar porque la base de datos no respondió: ninguna reserva quedó a medias y la próxima ejecución completa lo que faltó.',
      );
      return false;
    }
  }

  /**
   * La alerta de negocio del caso borde "la zona horaria del servidor difiere de la de Colombia": compara el
   * desfase con UTC del servidor y el de `America/Bogota` en ese instante.
   */
  private alertIfServerTimeZoneDiffers(now: Date): void {
    const serverOffset = -now.getTimezoneOffset();
    const hotelOffset = DateTime.fromJSDate(now).setZone(JOBS_TIME_ZONE).offset;
    if (serverOffset === hotelOffset) {
      return;
    }
    const serverZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    this.logger.error(
      `Alerta: la zona horaria del servidor (${serverZone}, UTC${utcOffset(serverOffset)}) no es la del hotel (${JOBS_TIME_ZONE}, UTC${utcOffset(hotelOffset)}). El cierre del día usa la del hotel.`,
    );
  }
}

/** Un desfase en minutos como `+00:00` o `-05:00`. */
function utcOffset(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  const absolute = Math.abs(minutes);
  const hours = String(Math.floor(absolute / 60)).padStart(2, '0');
  return `${sign}${hours}:${String(absolute % 60).padStart(2, '0')}`;
}
