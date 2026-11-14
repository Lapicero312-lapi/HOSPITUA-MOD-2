import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannexSetupState } from '../../../../../src/application/ports/out/channex-setup-state.js';
import type { PublishDailyAvailability } from '../../../../../src/application/use-cases/configure-ota/ports/in/publish-daily-availability.port.js';
import type { SyncRoomTypes } from '../../../../../src/application/use-cases/configure-ota/ports/in/sync-room-types.port.js';
import type { AdvisoryLock } from '../../../../../src/infrastructure/in/jobs/advisory-lock.js';
import {
  ARI_DAILY_CRON,
  ARI_DAILY_LOCK_RETRY_MS,
  ARI_DAILY_LOCK_WAIT_MS,
  AriDailyJob,
} from '../../../../../src/infrastructure/in/jobs/ari-daily.job.js';
import { CHANNEX_SYNC_LOCK } from '../../../../../src/infrastructure/in/jobs/channex-sync.job.js';

/** La tarea; `busyTimes` es cuántas veces seguidas encuentra el bloqueo ocupado antes de conseguirlo. */
function aJob({
  ready = true,
  busyTimes = 0,
  feedRead = true,
}: { ready?: boolean; busyTimes?: number; feedRead?: boolean | Error } = {}) {
  const calls: string[] = [];
  const run = vi.fn(() => {
    calls.push('feed');
    return feedRead instanceof Error
      ? Promise.reject(feedRead)
      : Promise.resolve(feedRead);
  });
  const sync = vi.fn<SyncRoomTypes['sync']>(() => {
    calls.push('sync');
    return Promise.resolve({ status: 'SYNCED', created: [] });
  });
  const publish = vi.fn<PublishDailyAvailability['publish']>(() => {
    calls.push('publish');
    return Promise.resolve({ status: 'SENT', categories: ['DOBLE'] });
  });
  const markAllPending = vi.fn<PublishDailyAvailability['markAllPending']>(
    () => {
      calls.push('markAllPending');
      return Promise.resolve();
    },
  );
  const state = { isReady: () => ready } as unknown as ChannexSetupState;
  let busy = busyTimes;
  const runExclusive = vi.fn(
    async (_name: string, task: () => Promise<void>) => {
      if (busy > 0) {
        busy -= 1;
        return false;
      }
      calls.push('lock');
      await task();
      return true;
    },
  );
  const job = new AriDailyJob(
    { run },
    { sync },
    { publish, markAllPending },
    state,
    { runExclusive } as unknown as AdvisoryLock,
  );
  return { job, calls, run, sync, publish, markAllPending, runExclusive };
}

describe('AriDailyJob (plan de configure-ota, regla 5 y B4; T011)', () => {
  let errors: string[];
  let warnings: string[];

  beforeEach(() => {
    vi.useFakeTimers();
    errors = [];
    warnings = [];
    vi.spyOn(Logger.prototype, 'error').mockImplementation((message) => {
      errors.push(String(message));
    });
    vi.spyOn(Logger.prototype, 'warn').mockImplementation((message) => {
      warnings.push(String(message));
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('corre a las 03:00:00 todos los días', () => {
    expect(ARI_DAILY_CRON).toBe('0 0 3 * * *');
  });

  it('con el bloqueo de las tareas de Channex: el feed, los tipos y la disponibilidad completa, en ese orden', async () => {
    const { job, calls, runExclusive } = aJob();

    expect(await job.run()).toBe(true);

    expect(runExclusive).toHaveBeenCalledExactlyOnceWith(
      CHANNEX_SYNC_LOCK,
      expect.any(Function),
    );
    expect(calls).toEqual(['lock', 'feed', 'sync', 'publish']);
  });

  it('sin la configuración de Channex lista no hace nada', async () => {
    const { job, runExclusive } = aJob({ ready: false });

    expect(await job.run()).toBe(false);

    expect(runExclusive).not.toHaveBeenCalled();
  });

  describe('el feed no se leyó (FR-007)', () => {
    it.each([
      ['no se leyó', false],
      ['falló por un error inesperado', new Error('inesperado')],
    ])(
      'si %s: los tipos se sincronizan igual y la disponibilidad queda como marcas, sin enviarse',
      async (_case, feedRead) => {
        const { job, calls } = aJob({ feedRead });

        expect(await job.run()).toBe(true);

        expect(calls).toEqual(['lock', 'feed', 'sync', 'markAllPending']);
      },
    );
  });

  it('un error inesperado de los tipos no impide la disponibilidad', async () => {
    const { job, calls, sync } = aJob();
    sync.mockRejectedValueOnce(new Error('la base no responde'));

    expect(await job.run()).toBe(true);

    expect(calls).toEqual(['lock', 'feed', 'publish']);
    expect(errors.some((e) => e.includes('los tipos de habitación'))).toBe(
      true,
    );
  });

  describe('el bloqueo ocupado (un ciclo de 30 s)', () => {
    it('lo reintenta cada 5 s y, cuando lo consigue, corre los tres pasos', async () => {
      const { job, calls, runExclusive } = aJob({ busyTimes: 2 });

      const running = job.run();
      await vi.advanceTimersByTimeAsync(2 * ARI_DAILY_LOCK_RETRY_MS);

      expect(await running).toBe(true);
      expect(runExclusive).toHaveBeenCalledTimes(3);
      expect(calls).toEqual(['lock', 'feed', 'sync', 'publish']);
    });

    it('si sigue ocupado 10 minutos, lo registra y la disponibilidad queda como marcas', async () => {
      const { job, calls, runExclusive } = aJob({ busyTimes: 1_000 });

      const running = job.run();
      await vi.advanceTimersByTimeAsync(ARI_DAILY_LOCK_WAIT_MS);

      expect(await running).toBe(false);
      // El primer intento y uno cada 5 s, el último a los 10 minutos.
      expect(runExclusive).toHaveBeenCalledTimes(
        ARI_DAILY_LOCK_WAIT_MS / ARI_DAILY_LOCK_RETRY_MS + 1,
      );
      expect(calls).toEqual(['markAllPending']);
      expect(errors.some((e) => e.includes('no consiguió el bloqueo'))).toBe(
        true,
      );
    });

    it('al apagar la aplicación deja de esperar el bloqueo', async () => {
      const { job, runExclusive, markAllPending } = aJob({ busyTimes: 1_000 });

      const running = job.run();
      await vi.advanceTimersByTimeAsync(ARI_DAILY_LOCK_RETRY_MS);
      const shutdown = job.beforeApplicationShutdown();
      await vi.advanceTimersByTimeAsync(ARI_DAILY_LOCK_RETRY_MS);
      await shutdown;

      expect(await running).toBe(false);
      expect(runExclusive.mock.calls.length).toBeLessThan(5);
      expect(markAllPending).toHaveBeenCalledOnce();
    });
  });

  it('un error inesperado fuera de los pasos se registra y no lanza', async () => {
    const { job, runExclusive } = aJob();
    runExclusive.mockRejectedValueOnce(new Error('sin conexión'));

    expect(await job.run()).toBe(false);
    expect(errors.some((e) => e.includes('error inesperado'))).toBe(true);
  });
});
