import { Logger } from '@nestjs/common';
import { ScheduleModule, SchedulerRegistry } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CLOCK,
  type Clock,
} from '../../../../../src/application/ports/out/clock.js';
import {
  CLOSE_DAY,
  type CloseDay,
} from '../../../../../src/application/use-cases/update-reservation/ports/in/close-day.port.js';
import { AdvisoryLock } from '../../../../../src/infrastructure/in/jobs/advisory-lock.js';
import {
  CLOSE_DAY_JOB,
  CLOSE_DAY_LOCK,
  CloseDayJob,
} from '../../../../../src/infrastructure/in/jobs/close-day.job.js';

/** Las 00:00:30 del 10 de octubre en Colombia: el día que terminó es el 9. */
const NOW = new Date('2026-10-10T05:00:30.000Z');
const TODAY = '2026-10-10';

/** La tarea con `CloseDay` y el reloj simulados, y el bloqueo libre u ocupado por otra instancia. */
function aJob({ locked = false }: { locked?: boolean } = {}) {
  const closePendingDays = vi
    .fn<CloseDay['closePendingDays']>()
    .mockResolvedValue([]);
  const execute = vi.fn<CloseDay['execute']>();
  const clock: Clock = { now: () => NOW, today: () => TODAY };
  // Sin base de datos: corre la tarea salvo que otra ejecución tenga el bloqueo.
  const runExclusive = vi.fn(
    async (_name: string, task: () => Promise<void>) => {
      if (locked) {
        return false;
      }
      await task();
      return true;
    },
  );
  const job = new CloseDayJob({ execute, closePendingDays }, clock, {
    runExclusive,
  } as unknown as AdvisoryLock);
  return { job, closePendingDays, execute, runExclusive };
}

/** Una promesa que la prueba resuelve cuando quiere. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** El mensaje de la alerta por la pérdida de la base de datos: sin el texto del error. */
const DATABASE_ALERT =
  'El cierre del día se detuvo antes de terminar porque la base de datos no respondió: ninguna reserva quedó a medias y la próxima ejecución completa lo que faltó.';

describe('CloseDayJob (plan de update-reservation, D, D5 y punto 14; T022)', () => {
  let errors: string[];

  beforeEach(() => {
    errors = [];
    vi.spyOn(Logger.prototype, 'error').mockImplementation(
      (message: unknown) => {
        errors.push(String(message));
      },
    );
    // La máquina de las pruebas, en la zona del hotel: sin la alerta de zona horaria salvo que la prueba
    // cambie la zona.
    vi.stubEnv('TZ', 'America/Bogota');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('cierra los días pendientes hasta hoy, sin incluirlo, con el bloqueo asesor close-day', async () => {
    const { job, closePendingDays, execute, runExclusive } = aJob();

    await expect(job.run()).resolves.toBe(true);

    // El nombre escrito tal cual: es el que comparten todas las instancias (y el de la prueba con la base).
    expect(CLOSE_DAY_LOCK).toBe('close-day');
    expect(runExclusive).toHaveBeenCalledExactlyOnceWith(
      'close-day',
      expect.any(Function),
    );
    // El día de hoy del Clock (la zona del hotel): CloseDay cierra los anteriores.
    expect(closePendingDays).toHaveBeenCalledExactlyOnceWith(TODAY);
    expect(execute).not.toHaveBeenCalled();
    expect(errors).toEqual([]);
  });

  it('se salta la ejecución si otra instancia tiene el bloqueo', async () => {
    const { job, closePendingDays } = aJob({ locked: true });

    await expect(job.run()).resolves.toBe(false);

    expect(closePendingDays).not.toHaveBeenCalled();
    expect(errors).toEqual([]);
  });

  it('al arrancar cierra lo pendiente (la recuperación)', async () => {
    const { job, closePendingDays } = aJob();

    await job.onApplicationBootstrap();

    expect(closePendingDays).toHaveBeenCalledExactlyOnceWith(TODAY);
  });

  it('el arranque espera a que termine la recuperación', async () => {
    const { job, closePendingDays } = aJob();
    const closing = deferred<[]>();
    closePendingDays.mockReturnValueOnce(closing.promise);

    let started = false;
    const bootstrap = job.onApplicationBootstrap().then(() => {
      started = true;
    });
    // Una vuelta completa del ciclo de eventos: si el arranque no esperara, ya habría terminado.
    await new Promise((resolve) => setImmediate(resolve));
    expect(started).toBe(false);

    closing.resolve([]);
    await bootstrap;
    expect(started).toBe(true);
  });

  it('a las 00:00:30 cierra lo pendiente', async () => {
    const { job, closePendingDays } = aJob();

    await job.onSchedule();

    expect(closePendingDays).toHaveBeenCalledExactlyOnceWith(TODAY);
  });

  describe('pérdida de la base de datos (caso borde)', () => {
    it('deja la alerta sin detalles de infraestructura, devuelve false y no lanza', async () => {
      const { job, closePendingDays } = aJob();
      closePendingDays.mockRejectedValueOnce(
        new Error(
          'connect ECONNREFUSED 10.0.0.5:5432 (usuario hospitua, base m2)',
        ),
      );

      await expect(job.run()).resolves.toBe(false);

      expect(errors).toEqual([DATABASE_ALERT]);
      expect(errors.join()).not.toMatch(/ECONNREFUSED|5432|hospitua/);
    });

    it('también si falla el bloqueo asesor, que necesita la base', async () => {
      const { job, runExclusive, closePendingDays } = aJob();
      runExclusive.mockRejectedValueOnce(new Error('Connection terminated'));

      await expect(job.run()).resolves.toBe(false);

      expect(closePendingDays).not.toHaveBeenCalled();
      expect(errors).toEqual([DATABASE_ALERT]);
    });

    it('el arranque termina igual, y la siguiente ejecución vuelve a intentarlo', async () => {
      const { job, closePendingDays } = aJob();
      closePendingDays.mockRejectedValueOnce(
        new Error('Connection terminated'),
      );

      await expect(job.onApplicationBootstrap()).resolves.toBeUndefined();
      await expect(job.run()).resolves.toBe(true);

      expect(closePendingDays).toHaveBeenCalledTimes(2);
    });
  });

  describe('zona horaria del servidor (caso borde)', () => {
    it('con otra zona (UTC) deja la alerta de negocio y sigue con el día del hotel', async () => {
      vi.stubEnv('TZ', 'UTC');
      const { job, closePendingDays } = aJob();

      await expect(job.run()).resolves.toBe(true);

      expect(errors).toEqual([
        'Alerta: la zona horaria del servidor (UTC, UTC+00:00) no es la del hotel (America/Bogota, UTC-05:00). El cierre del día usa la del hotel.',
      ]);
      expect(closePendingDays).toHaveBeenCalledExactlyOnceWith(TODAY);
    });

    it('con una zona adelantada (Asia/Tokyo) también, con su desfase', async () => {
      vi.stubEnv('TZ', 'Asia/Tokyo');
      const { job } = aJob();

      await job.run();

      expect(errors).toEqual([
        'Alerta: la zona horaria del servidor (Asia/Tokyo, UTC+09:00) no es la del hotel (America/Bogota, UTC-05:00). El cierre del día usa la del hotel.',
      ]);
    });

    it('con una zona de nombre distinto pero la misma hora (America/Lima) no hay alerta', async () => {
      vi.stubEnv('TZ', 'America/Lima');
      const { job } = aJob();

      await job.run();

      expect(errors).toEqual([]);
    });

    it('la alerta sale aunque otra instancia tenga el bloqueo', async () => {
      vi.stubEnv('TZ', 'UTC');
      const { job } = aJob({ locked: true });

      await job.run();

      expect(errors).toHaveLength(1);
    });
  });

  it('al apagar espera a que termine la ejecución en curso', async () => {
    const { job, closePendingDays } = aJob();
    const closing = deferred<[]>();
    closePendingDays.mockReturnValueOnce(closing.promise);
    void job.run();
    await vi.waitFor(() => expect(closePendingDays).toHaveBeenCalled());

    let stopped = false;
    const shutdown = job.beforeApplicationShutdown().then(() => {
      stopped = true;
    });
    // Una vuelta completa del ciclo de eventos: si el apagado no esperara la ejecución, ya habría terminado.
    await new Promise((resolve) => setImmediate(resolve));
    expect(stopped).toBe(false);

    closing.resolve([]);
    await shutdown;
    expect(stopped).toBe(true);
  });

  it('al apagar sin una ejecución en curso termina enseguida', async () => {
    const { job } = aJob();
    await job.run();

    await expect(job.beforeApplicationShutdown()).resolves.toBeUndefined();
  });

  describe('programada con @nestjs/schedule', () => {
    async function scheduledJob() {
      const moduleRef = await Test.createTestingModule({
        imports: [ScheduleModule.forRoot()],
        providers: [
          CloseDayJob,
          {
            provide: AdvisoryLock,
            useValue: { runExclusive: vi.fn().mockResolvedValue(true) },
          },
          {
            provide: CLOSE_DAY,
            useValue: { closePendingDays: vi.fn().mockResolvedValue([]) },
          },
          {
            provide: CLOCK,
            useValue: { now: () => NOW, today: () => TODAY },
          },
        ],
      }).compile();
      await moduleRef.init();
      const cron = moduleRef.get(SchedulerRegistry).getCronJob(CLOSE_DAY_JOB);
      return { moduleRef, cron };
    }

    it('corre todos los días a las 00:00:30 de America/Bogota (05:00:30 UTC), aunque el servidor esté en UTC', async () => {
      // La máquina en otra zona: si la tarea no fijara la suya, el cron correría a las 00:00:30 de UTC.
      vi.stubEnv('TZ', 'UTC');
      const { moduleRef, cron } = await scheduledJob();
      try {
        // Como `sendAt()` de cron: en la zona de la tarea, para no depender de dónde corre la prueba.
        const { cronTime } = cron;
        const at = (iso: string) =>
          cronTime.getNextDateFrom(new Date(iso), cronTime.timeZone).toJSDate();
        // A las 00:00 en Colombia todavía no: corre a las 00:00:30.
        expect(at('2026-10-10T05:00:00Z')).toEqual(
          new Date('2026-10-10T05:00:30Z'),
        );
        // Recién pasada la ejecución: la siguiente es al otro día, a la misma hora.
        expect(at('2026-10-10T05:00:30Z')).toEqual(
          new Date('2026-10-11T05:00:30Z'),
        );
        // A las 00:00 UTC (19:00 en Colombia) todavía no es el día siguiente en Colombia.
        expect(at('2026-10-11T00:00:00Z')).toEqual(
          new Date('2026-10-11T05:00:30Z'),
        );
      } finally {
        await moduleRef.close();
      }
    });
  });
});
