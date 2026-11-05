import { Logger } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannexSetupState } from '../../../../../src/application/ports/out/channex-setup-state.js';
import type { ReadBookingFeed } from '../../../../../src/application/use-cases/generate-ota-reservation/ports/in/read-booking-feed.port.js';
import type { AdvisoryLock } from '../../../../../src/infrastructure/in/jobs/advisory-lock.js';
import {
  CHANNEX_SYNC_INTERVAL,
  CHANNEX_SYNC_LOCK,
  ChannexSyncJob,
} from '../../../../../src/infrastructure/in/jobs/channex-sync.job.js';

const INTERVAL_SECONDS = 30;

const SETTINGS = {
  baseUrl: 'https://staging.channex.io',
  propertyId: '716305c4-561a-4561-a187-7f5b8aeb5920',
  syncIntervalSeconds: INTERVAL_SECONDS,
  ariDays: 90,
};

/** La tarea con la configuración, el estado y el bloqueo pedidos. */
function aJob({
  ready = true,
  withSettings = true,
  locked = false,
}: { ready?: boolean; withSettings?: boolean; locked?: boolean } = {}) {
  const read = vi
    .fn<ReadBookingFeed['read']>()
    .mockResolvedValue({ status: 'READ', revisions: [] });
  const state = {
    settings: () => (withSettings ? SETTINGS : null),
    isReady: () => ready,
  } as unknown as ChannexSetupState;
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
  const scheduler = new SchedulerRegistry();
  const job = new ChannexSyncJob(
    { read },
    state,
    { runExclusive } as unknown as AdvisoryLock,
    scheduler,
  );
  return { job, read, runExclusive, scheduler };
}

describe('ChannexSyncJob (plan de generate-ota-reservation, punto 7)', () => {
  let errors: string[];

  beforeEach(() => {
    vi.useFakeTimers();
    errors = [];
    vi.spyOn(Logger.prototype, 'error').mockImplementation(
      (message: unknown) => {
        errors.push(String(message));
      },
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('lee el feed cada CHANNEX_SYNC_INTERVAL_SECONDS desde el arranque', async () => {
    const { job, read, scheduler } = aJob();

    job.onApplicationBootstrap();
    expect(scheduler.doesExist('interval', CHANNEX_SYNC_INTERVAL)).toBe(true);

    await vi.advanceTimersByTimeAsync(INTERVAL_SECONDS * 1_000 - 1);
    expect(read).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(INTERVAL_SECONDS * 1_000);
    expect(read).toHaveBeenCalledTimes(2);

    job.onApplicationShutdown();
  });

  it('sin configuración válida no se programa', () => {
    const { job, scheduler } = aJob({ withSettings: false });

    job.onApplicationBootstrap();

    expect(scheduler.doesExist('interval', CHANNEX_SYNC_INTERVAL)).toBe(false);
  });

  it('al apagar la aplicación deja de programarse', async () => {
    const { job, read, scheduler } = aJob();
    job.onApplicationBootstrap();

    job.onApplicationShutdown();
    await vi.advanceTimersByTimeAsync(INTERVAL_SECONDS * 1_000 * 3);

    expect(scheduler.doesExist('interval', CHANNEX_SYNC_INTERVAL)).toBe(false);
    expect(read).not.toHaveBeenCalled();
  });

  it('lee el feed con el bloqueo asesor channex-sync', async () => {
    const { job, read, runExclusive } = aJob();

    await expect(job.run()).resolves.toBe(true);

    expect(runExclusive).toHaveBeenCalledExactlyOnceWith(
      CHANNEX_SYNC_LOCK,
      expect.any(Function),
    );
    expect(CHANNEX_SYNC_LOCK).toBe('channex-sync');
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('no hace nada mientras la configuración de Channex no esté lista', async () => {
    const { job, read, runExclusive } = aJob({ ready: false });

    await expect(job.run()).resolves.toBe(false);

    expect(runExclusive).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it('si otra ejecución tiene el bloqueo, se salta esta', async () => {
    const { job, read } = aJob({ locked: true });

    await expect(job.run()).resolves.toBe(false);

    expect(read).not.toHaveBeenCalled();
  });

  it('un error inesperado se registra y la siguiente ejecución lee de nuevo', async () => {
    const { job, read } = aJob();
    read.mockRejectedValueOnce(new Error('la base de datos no responde'));

    await expect(job.run()).resolves.toBe(false);
    expect(errors).toHaveLength(1);

    await expect(job.run()).resolves.toBe(true);
    expect(read).toHaveBeenCalledTimes(2);
  });
});
