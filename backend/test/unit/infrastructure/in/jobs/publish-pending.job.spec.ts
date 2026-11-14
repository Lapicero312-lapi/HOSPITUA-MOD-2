import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PUBLISH_PENDING_CRON,
  PublishPendingJob,
} from '../../../../../src/infrastructure/in/jobs/publish-pending.job.js';

describe('PublishPendingJob (T029 de check-view-reservation)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('corre cada 10 segundos', () => {
    expect(PUBLISH_PENDING_CRON).toBe('*/10 * * * * *');
  });

  it('cada ejecución llama a PublishPendingDailyMessages', async () => {
    const execute = vi.fn(() => Promise.resolve(3));
    const job = new PublishPendingJob({ execute });

    await job.onSchedule();

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('un error inesperado queda en el log, sin su texto, y no se propaga', async () => {
    const error = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    const job = new PublishPendingJob({
      execute: () => Promise.reject(new Error('host=db.interno password=x')),
    });

    await expect(job.run()).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).not.toContain('db.interno');
  });

  it('al apagar, espera la ejecución en curso', async () => {
    let finish: () => void = () => {};
    const job = new PublishPendingJob({
      execute: () =>
        new Promise<number>((resolve) => {
          finish = () => resolve(0);
        }),
    });
    void job.run();
    let shutDown = false;

    const shutdown = job.beforeApplicationShutdown().then(() => {
      shutDown = true;
    });
    await Promise.resolve();
    expect(shutDown).toBe(false);
    finish();
    await shutdown;

    expect(shutDown).toBe(true);
  });
});
