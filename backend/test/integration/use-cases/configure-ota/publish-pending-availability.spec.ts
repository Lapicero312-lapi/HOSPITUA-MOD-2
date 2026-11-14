import type { INestApplication } from '@nestjs/common';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import type { DataSource } from 'typeorm';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { Clock } from '../../../../src/application/ports/out/clock.js';
import { ChannexSyncJob } from '../../../../src/infrastructure/in/jobs/channex-sync.job.js';
import {
  aRevision,
  aSimulatedChannex,
  CHANNEX_BASE_URL,
  DOBLE_TYPE,
  PROPERTY_ID,
  type SimulatedChannex,
  simulate,
  startBookingFeedApp,
  useBookingFeedEnv,
} from '../../support/booking-feed-app.js';
import {
  openTestDataSource,
  truncateAllTables,
} from '../../support/database.js';

const NEW_REVISION = '03dd7198-c5b7-493c-a889-74d0c2211de7';

type SentValue = {
  property_id: string;
  room_type_id: string;
  date_from: string;
  date_to: string;
  availability: number;
};

/**
 * T010 de `configure-ota`: la disponibilidad pendiente llega a Channex, de punta a punta. Una reserva de
 * Booking que entra por el feed anota su categoría y sus noches (`AriChangeRecorder`), y en el mismo ciclo
 * de `ChannexSyncJob`, después del feed, `PublishPendingAvailability` envía el A4 y borra la marca. La
 * aplicación completa, con PostgreSQL real, y Channex y el Módulo 1 simulados en HTTP (msw); el Módulo 1
 * tiene la 201, la 202 y la 203 de `DOBLE`.
 */
describe('configure-ota: la disponibilidad pendiente llega a Channex (T010)', () => {
  const server = setupServer();
  let dataSource: DataSource;
  let app: INestApplication;
  let channex: SimulatedChannex;
  /** Cada A4 que recibió Channex, con sus valores; y con qué responde el siguiente. */
  let availabilityCalls: SentValue[][];
  let availabilityStatus: number;
  const clock: Clock = {
    now: () => new Date('2026-11-09T15:00:00.000Z'),
    today: () => '2026-11-09',
  };

  const cycle = async () => {
    await expect(app.get(ChannexSyncJob).run()).resolves.toBe(true);
  };
  const pendingMarks = async () => {
    const [{ total }]: { total: number }[] = await dataSource.query(
      'SELECT count(*)::int AS total FROM ari_pending_change',
    );
    return total;
  };

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    useBookingFeedEnv();
    server.listen({ onUnhandledRequest: 'bypass' });
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    await dataSource.query(
      `INSERT INTO ota_room_type_mapping (channex_room_type_id, category_room, count_of_rooms, occupancy)
       VALUES ($1, 'DOBLE', 3, 2)`,
      [DOBLE_TYPE],
    );
    channex = aSimulatedChannex();
    simulate(server, channex);
    availabilityCalls = [];
    availabilityStatus = 200;
    server.use(
      http.post(
        `${CHANNEX_BASE_URL}/api/v1/availability`,
        async ({ request }) => {
          const body = (await request.json()) as { values: SentValue[] };
          availabilityCalls.push(body.values);
          return availabilityStatus === 200
            ? HttpResponse.json({ data: [], meta: { message: 'Success' } })
            : HttpResponse.json({}, { status: availabilityStatus });
        },
      ),
    );
    app = await startBookingFeedApp(clock);
  });

  afterEach(async () => {
    await app.close();
    server.resetHandlers();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    server.close();
    await truncateAllTables(dataSource);
    await dataSource.destroy();
  });

  it('una reserva de Booking ocupa la 201 del 10 al 12: en el mismo ciclo, después del feed, Channex recibe 2 libres en esas noches y la marca se borra', async () => {
    channex.feed = [aRevision(NEW_REVISION)];

    await cycle();

    expect(availabilityCalls).toEqual([
      [
        {
          property_id: PROPERTY_ID,
          room_type_id: DOBLE_TYPE,
          date_from: '2026-11-10',
          date_to: '2026-11-11',
          availability: 2,
        },
      ],
    ]);
    expect(await pendingMarks()).toBe(0);
  });

  it('sin cambios no se llama a Channex', async () => {
    await cycle();

    expect(availabilityCalls).toEqual([]);
  });

  it('con Channex respondiendo 503 la marca se conserva; en el ciclo siguiente se envía y se borra', async () => {
    channex.feed = [aRevision(NEW_REVISION)];
    availabilityStatus = 503;

    await cycle();

    expect(availabilityCalls).toHaveLength(1);
    expect(await pendingMarks()).toBe(1);

    availabilityStatus = 200;
    channex.feed = [];
    await cycle();

    expect(availabilityCalls).toHaveLength(2);
    expect(availabilityCalls[1]).toEqual(availabilityCalls[0]);
    expect(await pendingMarks()).toBe(0);
  });
});
