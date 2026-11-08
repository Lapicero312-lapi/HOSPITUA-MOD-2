import { Logger } from '@nestjs/common';
import { ScheduleModule, SchedulerRegistry } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GENERATE_DAILY_LIST,
  type GenerateDailyList,
} from '../../../../../src/application/use-cases/check-view-reservation/ports/in/generate-daily-list.port.js';
import { AdvisoryLock } from '../../../../../src/infrastructure/in/jobs/advisory-lock.js';
import {
  DAILY_LIST_JOB,
  DAILY_LIST_LOCK,
  DailyListJob,
} from '../../../../../src/infrastructure/in/jobs/daily-list.job.js';

/** La tarea con `GenerateDailyList` simulado y el bloqueo libre u ocupado por otra instancia. */
function aJob({ locked = false }: { locked?: boolean } = {}) {
  const execute = vi.fn<GenerateDailyList['execute']>().mockResolvedValue(true);
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
  const job = new DailyListJob({ execute }, {
    runExclusive,
  } as unknown as AdvisoryLock);
  return { job, execute, runExclusive };
}

/** Una promesa que la prueba resuelve cuando quiere. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('DailyListJob (plan de check-view-reservation, "Tareas programadas" y D2; T024)', () => {
  let errors: string[];

  beforeEach(() => {
    errors = [];
    vi.spyOn(Logger.prototype, 'error').mockImplementation(
      (message: unknown) => {
        errors.push(String(message));
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('genera la lista del día en curso con el bloqueo asesor daily-list', async () => {
    const { job, execute, runExclusive } = aJob();

    await expect(job.run()).resolves.toBe(true);

    expect(runExclusive).toHaveBeenCalledWith(
      DAILY_LIST_LOCK,
      expect.any(Function),
    );
    // Sin fecha: GenerateDailyList toma el día operativo en curso (Clock.today()).
    expect(execute).toHaveBeenCalledExactlyOnceWith();
  });

  it('se salta la ejecución si otra instancia tiene el bloqueo', async () => {
    const { job, execute } = aJob({ locked: true });

    await expect(job.run()).resolves.toBe(false);

    expect(execute).not.toHaveBeenCalled();
  });

  it('al arrancar genera la lista (recuperación de un reinicio o una caída a las 00:00)', async () => {
    const { job, execute } = aJob();

    job.onApplicationBootstrap();

    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
  });

  it('a las 00:00 genera la lista', async () => {
    const { job, execute } = aJob();

    await job.onSchedule();

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('un error inesperado se registra, devuelve false y no impide la siguiente ejecución', async () => {
    const { job, execute } = aJob();
    execute.mockRejectedValueOnce(new Error('la base no responde'));

    await expect(job.run()).resolves.toBe(false);
    expect(errors).toEqual([
      'La generación de la lista del día falló por un error inesperado',
    ]);

    await expect(job.run()).resolves.toBe(true);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('al apagar espera a que termine la ejecución en curso', async () => {
    const { job, execute } = aJob();
    const generation = deferred<boolean>();
    execute.mockReturnValueOnce(generation.promise);
    void job.run();
    await vi.waitFor(() => expect(execute).toHaveBeenCalled());

    let stopped = false;
    const shutdown = job.beforeApplicationShutdown().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);

    generation.resolve(true);
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
          DailyListJob,
          {
            provide: AdvisoryLock,
            useValue: { runExclusive: vi.fn().mockResolvedValue(true) },
          },
          {
            provide: GENERATE_DAILY_LIST,
            useValue: { execute: vi.fn().mockResolvedValue(true) },
          },
        ],
      }).compile();
      await moduleRef.init();
      const cron = moduleRef.get(SchedulerRegistry).getCronJob(DAILY_LIST_JOB);
      return { moduleRef, cron };
    }

    it('corre todos los días a las 00:00:00 de America/Bogota (05:00 UTC)', async () => {
      const { moduleRef, cron } = await scheduledJob();
      try {
        const at = (iso: string) =>
          cron.cronTime.getNextDateFrom(new Date(iso)).toJSDate();
        // Un segundo antes de las 00:00 en Colombia: corre a las 00:00.
        expect(at('2026-10-09T04:59:59Z')).toEqual(
          new Date('2026-10-09T05:00:00Z'),
        );
        // Recién pasada la ejecución: la siguiente es al otro día, a la misma hora.
        expect(at('2026-10-09T05:00:00Z')).toEqual(
          new Date('2026-10-10T05:00:00Z'),
        );
        // A las 00:00 UTC (19:00 en Colombia) todavía no es el día siguiente en Colombia.
        expect(at('2026-10-10T00:00:00Z')).toEqual(
          new Date('2026-10-10T05:00:00Z'),
        );
      } finally {
        await moduleRef.close();
      }
    });
  });
});
