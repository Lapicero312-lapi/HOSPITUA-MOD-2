import { Logger } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannexSetupState } from '../../../../../src/application/ports/out/channex-setup-state.js';
import type { EnsureChannexSetup } from '../../../../../src/application/use-cases/configure-ota/ports/in/ensure-channex-setup.port.js';
import type { ChannexVerification } from '../../../../../src/application/use-cases/configure-ota/ports/in/verify-channex-property.port.js';
import {
  CHANNEX_SETUP_RETRY,
  ChannexSetupJob,
} from '../../../../../src/infrastructure/in/jobs/channex-setup.job.js';

const INTERVAL_SECONDS = 45;

/** Un `EnsureChannexSetup` que responde, en orden, los resultados pedidos. */
function jobAnswering(...results: (ChannexVerification | Error)[]) {
  const ensure = vi.fn(() => {
    const next = results.shift() ?? 'READY';
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  });
  const state = {
    settings: () => ({
      baseUrl: 'https://staging.channex.io',
      propertyId: '716305c4-561a-4561-a187-7f5b8aeb5920',
      syncIntervalSeconds: INTERVAL_SECONDS,
      ariDays: 90,
    }),
  } as unknown as ChannexSetupState;
  const scheduler = new SchedulerRegistry();
  const job = new ChannexSetupJob(
    { ensure } as EnsureChannexSetup,
    state,
    scheduler,
  );
  return { job, ensure, scheduler };
}

const retryPending = (scheduler: SchedulerRegistry) =>
  scheduler.doesExist('timeout', CHANNEX_SETUP_RETRY);

describe('ChannexSetupJob', () => {
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

  it('al arrancar llama a EnsureChannexSetup sin esperar, y con READY no programa nada', async () => {
    const { job, ensure, scheduler } = jobAnswering('READY');

    job.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);

    expect(ensure).toHaveBeenCalledTimes(1);
    expect(retryPending(scheduler)).toBe(false);
  });

  it('no bloquea el arranque: onApplicationBootstrap termina aunque ensure() no termine nunca', async () => {
    const ensure = vi.fn(
      () => new Promise<ChannexVerification>(() => undefined),
    );
    const job = new ChannexSetupJob(
      { ensure } as EnsureChannexSetup,
      { settings: () => null } as unknown as ChannexSetupState,
      new SchedulerRegistry(),
    );

    // Nest espera lo que devuelve onApplicationBootstrap: tiene que terminar enseguida.
    const outcome = await Promise.race([
      Promise.resolve(job.onApplicationBootstrap()).then(() => 'terminó'),
      vi.advanceTimersByTimeAsync(60_000).then(() => 'quedó esperando'),
    ]);

    expect(outcome).toBe('terminó');
    expect(ensure).toHaveBeenCalledTimes(1);
  });

  it('con DISABLED no vuelve a intentar', async () => {
    const { job, scheduler } = jobAnswering('DISABLED');

    await expect(job.attempt()).resolves.toBe('DISABLED');
    expect(retryPending(scheduler)).toBe(false);
  });

  it('con RETRY lo repite cada CHANNEX_SYNC_INTERVAL_SECONDS hasta que da READY', async () => {
    const { job, ensure, scheduler } = jobAnswering('RETRY', 'RETRY', 'READY');

    await job.attempt();
    expect(retryPending(scheduler)).toBe(true);

    await vi.advanceTimersByTimeAsync(INTERVAL_SECONDS * 1_000 - 1);
    expect(ensure).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(ensure).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(INTERVAL_SECONDS * 1_000);
    expect(ensure).toHaveBeenCalledTimes(3);
    expect(retryPending(scheduler)).toBe(false);

    await vi.advanceTimersByTimeAsync(INTERVAL_SECONDS * 1_000 * 3);
    expect(ensure).toHaveBeenCalledTimes(3);
  });

  it('un error inesperado se registra y se trata como RETRY', async () => {
    const { job, ensure, scheduler } = jobAnswering(
      new Error('la base no responde'),
      'READY',
    );

    await expect(job.attempt()).resolves.toBe('RETRY');
    expect(errors).toEqual([
      'La configuración de Channex falló por un error inesperado: se reintenta',
    ]);
    expect(retryPending(scheduler)).toBe(true);

    await vi.advanceTimersByTimeAsync(INTERVAL_SECONDS * 1_000);
    expect(ensure).toHaveBeenCalledTimes(2);
    expect(retryPending(scheduler)).toBe(false);
  });

  it('al apagar la aplicación cancela el reintento pendiente', async () => {
    const { job, ensure, scheduler } = jobAnswering('RETRY');

    await job.attempt();
    job.onApplicationShutdown();
    await vi.advanceTimersByTimeAsync(INTERVAL_SECONDS * 1_000 * 2);

    expect(retryPending(scheduler)).toBe(false);
    expect(ensure).toHaveBeenCalledTimes(1);
  });
});
