import { Logger } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannexSetupState } from '../../../../../src/application/ports/out/channex-setup-state.js';
import type { PublishPendingNoShows } from '../../../../../src/application/use-cases/generate-ota-reservation/ports/in/publish-pending-no-shows.port.js';
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
  /** El orden en que se llamaron la lectura del feed y el envío de los no-shows. */
  const calls: string[] = [];
  const read = vi.fn<ReadBookingFeed['read']>().mockImplementation(() => {
    calls.push('read');
    return Promise.resolve({ status: 'READ', revisions: [] });
  });
  const publish = vi
    .fn<PublishPendingNoShows['publish']>()
    .mockImplementation(() => {
      calls.push('publish');
      return Promise.resolve({ reported: 0, rejected: 0, pending: 0 });
    });
  const availability = vi.fn(() => {
    calls.push('availability');
    return Promise.resolve({ status: 'NOTHING_PENDING' as const });
  });
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
    // El ciclo del feed (T007): aquí solo cuenta que se llame, como antes la lectura.
    {
      run: async () => {
        await read();
      },
    },
    { publish: availability },
    { publish },
    state,
    { runExclusive } as unknown as AdvisoryLock,
    scheduler,
  );
  return { job, read, availability, publish, calls, runExclusive, scheduler };
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
    const { job, read, availability, publish, runExclusive } = aJob({
      ready: false,
    });

    await expect(job.run()).resolves.toBe(false);

    expect(runExclusive).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(availability).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it('si otra ejecución tiene el bloqueo, se salta esta', async () => {
    const { job, read, availability, publish } = aJob({ locked: true });

    await expect(job.run()).resolves.toBe(false);

    expect(read).not.toHaveBeenCalled();
    expect(availability).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it('en el mismo bloqueo: primero el feed, después la disponibilidad pendiente (B3 de configure-ota) y al final los no-shows (punto 8)', async () => {
    const { job, calls, runExclusive } = aJob();

    await expect(job.run()).resolves.toBe(true);

    expect(calls).toEqual(['read', 'availability', 'publish']);
    expect(runExclusive).toHaveBeenCalledTimes(1);
  });

  it('envía los no-shows aunque la lectura no haya podido leer el feed: el reporte no depende del feed', async () => {
    const { job, read, publish } = aJob();
    read.mockResolvedValueOnce({ status: 'NOT_READ' });

    await expect(job.run()).resolves.toBe(true);

    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('un error inesperado al enviar los no-shows se registra y el ciclo siguiente los envía de nuevo', async () => {
    const { job, publish } = aJob();
    publish.mockRejectedValueOnce(new Error('la base de datos no responde'));

    await expect(job.run()).resolves.toBe(true);
    expect(errors).toEqual([
      'El paso de Channex "los no-shows" falló por un error inesperado: se intenta en el siguiente ciclo',
    ]);

    await expect(job.run()).resolves.toBe(true);
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it('un error inesperado del feed se registra, no se envía la disponibilidad (FR-007) y los no-shows sí; la siguiente ejecución lee de nuevo', async () => {
    const { job, read, calls } = aJob();
    read.mockRejectedValueOnce(new Error('la base de datos no responde'));

    await expect(job.run()).resolves.toBe(true);
    expect(errors).toEqual([
      'El paso de Channex "el feed" falló por un error inesperado: se intenta en el siguiente ciclo',
    ]);
    // La lectura falló (su simulación no anota nada): sin el feed procesado no se envía la disponibilidad,
    // y los no-shows, que no dependen del feed, sí.
    expect(calls).toEqual(['publish']);

    await expect(job.run()).resolves.toBe(true);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('un error inesperado de la disponibilidad pendiente se registra y los no-shows se envían igual', async () => {
    const { job, availability, publish } = aJob();
    availability.mockRejectedValueOnce(
      new Error('la base de datos no responde'),
    );

    await expect(job.run()).resolves.toBe(true);

    expect(errors).toEqual([
      'El paso de Channex "la disponibilidad pendiente" falló por un error inesperado: se intenta en el siguiente ciclo',
    ]);
    expect(publish).toHaveBeenCalledTimes(1);
  });
});
