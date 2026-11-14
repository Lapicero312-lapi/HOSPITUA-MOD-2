import { SchedulerRegistry } from '@nestjs/schedule';
import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  type BookingFeedPage,
  type ChannexPort,
  ChannexUnauthorizedError,
} from '../../../../src/application/ports/out/channex.port.js';
import type { ChannexSetupState } from '../../../../src/application/ports/out/channex-setup-state.js';
import { ReadBookingFeedService } from '../../../../src/application/use-cases/generate-ota-reservation/read-booking-feed.service.js';
import { ManageOtaService } from '../../../../src/application/use-cases/register-ota-information-commission/manage-ota.service.js';
import { OtaConnectionTrackerService } from '../../../../src/application/use-cases/register-ota-information-commission/ota-connection-tracker.service.js';
import { AdvisoryLock } from '../../../../src/infrastructure/in/jobs/advisory-lock.js';
import { ChannexSyncJob } from '../../../../src/infrastructure/in/jobs/channex-sync.job.js';
import { TypeOrmOtaRepository } from '../../../../src/infrastructure/out/persistence/repositories/ota.repository.js';
import { anOta } from '../../../support/builders.js';
import {
  openTestDataSource,
  truncateAllTables,
} from '../../support/database.js';

/** La hora de la lectura. La agencia de `anOta` es Booking.com, registrada antes. */
const NOW = new Date('2026-11-05T14:30:00.000Z');

/** Un Channex que responde siempre lo mismo y cuenta las lecturas; `gate` retiene la respuesta. */
function channexAnswering(answer: BookingFeedPage | Error) {
  const calls = { count: 0 };
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = false;
  const channex = {
    fetchBookingFeed: async () => {
      calls.count += 1;
      if (held) {
        await gate;
      }
      if (answer instanceof Error) {
        throw answer;
      }
      return answer;
    },
  } as unknown as ChannexPort;
  return {
    channex,
    calls,
    hold: () => {
      held = true;
    },
    release: () => release(),
  };
}

describe('ReadBookingFeed y ChannexSyncJob contra PostgreSQL real', () => {
  let dataSource: DataSource;
  let otas: TypeOrmOtaRepository;

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    otas = new TypeOrmOtaRepository(dataSource);
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  function feedWith(channex: ChannexPort) {
    return new ReadBookingFeedService(
      channex,
      new ManageOtaService(otas),
      new OtaConnectionTrackerService(otas),
      { now: () => NOW, today: () => '2026-11-05' },
    );
  }

  it('una lectura que termina bien actualiza lastSyncAt y vuelve a CONNECTED, sin cambiar linkedAt ni el porcentaje', async () => {
    const before = await otas.insert(
      anOta({ connectionStatus: 'DISCONNECTED' }),
    );
    const { channex } = channexAnswering({ revisions: [], total: 0 });

    await expect(feedWith(channex).read()).resolves.toEqual({
      status: 'READ',
      revisions: [],
    });

    const after = await otas.findById(before.id);
    expect(after?.connectionStatus).toBe('CONNECTED');
    expect(after?.lastSyncAt).toEqual(NOW);
    expect(after?.linkedAt).toEqual(before.linkedAt);
    expect(after?.commissionPercentage).toBe(before.commissionPercentage);
  });

  it('con 401 pasa la agencia a DISCONNECTED y conserva la última lectura que terminó bien', async () => {
    const before = await otas.insert(anOta());
    const { channex } = channexAnswering(new ChannexUnauthorizedError(401));

    await expect(feedWith(channex).read()).resolves.toEqual({
      status: 'NOT_READ',
    });

    const after = await otas.findById(before.id);
    expect(after?.connectionStatus).toBe('DISCONNECTED');
    expect(after?.lastSyncAt).toEqual(before.lastSyncAt);
  });

  it('no crea otra agencia: usa la Booking.com que ya registró configure-ota', async () => {
    await otas.insert(anOta());
    const { channex } = channexAnswering({ revisions: [], total: 0 });

    await feedWith(channex).read();

    const [{ count }]: { count: string }[] = await dataSource.query(
      'SELECT count(*) AS count FROM ota',
    );
    expect(Number(count)).toBe(1);
  });

  it('dos ejecuciones a la vez del job: el bloqueo asesor deja leer solo a una', async () => {
    await otas.insert(anOta());
    const fake = channexAnswering({ revisions: [], total: 0 });
    fake.hold();
    const state = {
      settings: () => null,
      isReady: () => true,
    } as unknown as ChannexSetupState;
    const feed = feedWith(fake.channex);
    const job = new ChannexSyncJob(
      // El ciclo del feed (T007) reducido a la lectura: la prueba es del bloqueo.
      {
        run: async () => {
          await feed.read();
        },
      },
      // Sin disponibilidad ni no-shows pendientes: la prueba es de la lectura del feed.
      {
        publish: () => Promise.resolve({ status: 'NOTHING_PENDING' as const }),
      },
      // (los no-shows): la prueba es de la lectura del feed.
      {
        publish: () =>
          Promise.resolve({ reported: 0, rejected: 0, pending: 0 }),
      },
      state,
      new AdvisoryLock(dataSource),
      new SchedulerRegistry(),
    );

    const first = job.run();
    // Espera a que la primera tenga el bloqueo y esté leyendo.
    await expect.poll(() => fake.calls.count).toBe(1);
    const second = await job.run();
    fake.release();

    expect(second).toBe(false);
    await expect(first).resolves.toBe(true);
    expect(fake.calls.count).toBe(1);
  });
});
