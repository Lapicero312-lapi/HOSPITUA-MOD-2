import type { INestApplication } from '@nestjs/common';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import type { DataSource, QueryRunner } from 'typeorm';
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
import { AriDailyJob } from '../../../../src/infrastructure/in/jobs/ari-daily.job.js';
import { CHANNEX_SYNC_LOCK } from '../../../../src/infrastructure/in/jobs/channex-sync.job.js';
import {
  aRevision,
  aSimulatedChannex,
  CHANNEX_BASE_URL,
  DOBLE_TYPE,
  PROPERTY_ID,
  type SimulatedChannex,
  simulate,
  startBookingFeedApp,
  SUITE_TYPE,
  useBookingFeedEnv,
} from '../../support/booking-feed-app.js';
import {
  openTestDataSource,
  truncateAllTables,
} from '../../support/database.js';

const NEW_REVISION = '5b0b3e1a-7c2d-4e8f-9a6b-3c4d5e6f7a8b';
const TODAY = '2026-11-09';
/** La última noche de los 90 días (`CHANNEX_ARI_DAYS`) y el día siguiente, el fin excluido de las marcas. */
const LAST_NIGHT = '2027-02-06';
const LIMIT = '2027-02-07';

type SentValue = {
  property_id: string;
  room_type_id: string;
  date_from: string;
  date_to: string;
  availability: number;
};

/**
 * T011 de `configure-ota`: el envío de las 03:00 (`AriDailyJob`), de punta a punta. Con el bloqueo de las
 * tareas de Channex, lee el feed, sincroniza los tipos y envía la disponibilidad de los 90 días de todas las
 * categorías en un solo A4; lo que no sale queda como marcas (B2) para el ciclo de 30 s. La aplicación
 * completa, con PostgreSQL real, y Channex y el Módulo 1 simulados en HTTP (msw): la 201, la 202 y la 203 de
 * `DOBLE`, y la 305 de `SUITE`.
 */
describe('configure-ota: el envío de las 03:00 (T011)', () => {
  const server = setupServer();
  let dataSource: DataSource;
  let app: INestApplication;
  let channex: SimulatedChannex;
  /** Lo que pasó en Channex, en orden: `feed` y `availability`. */
  let calls: string[];
  let availabilityCalls: SentValue[][];
  let availabilityStatus: number;
  const clock: Clock = {
    now: () => new Date('2026-11-09T08:00:00.000Z'),
    today: () => TODAY,
  };

  const marks = (): Promise<
    { category_room: string; date_from: string; date_to: string }[]
  > =>
    dataSource.query(
      `SELECT category_room, to_char(date_from, 'YYYY-MM-DD') AS date_from,
              to_char(date_to, 'YYYY-MM-DD') AS date_to
       FROM ari_pending_change ORDER BY category_room`,
    );

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    useBookingFeedEnv();
    server.listen({ onUnhandledRequest: 'bypass' });
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    // Los tipos ya existen en Channex con la cantidad y la capacidad del Módulo 1: la sincronización no
    // cambia nada.
    await dataSource.query(
      `INSERT INTO ota_room_type_mapping (channex_room_type_id, category_room, count_of_rooms, occupancy)
       VALUES ($1, 'DOBLE', 3, 2), ($2, 'SUITE', 1, 2)`,
      [DOBLE_TYPE, SUITE_TYPE],
    );
    channex = aSimulatedChannex();
    simulate(server, channex);
    calls = [];
    availabilityCalls = [];
    availabilityStatus = 200;
    server.use(
      http.get(`${CHANNEX_BASE_URL}/api/v1/booking_revisions/feed`, () => {
        calls.push('feed');
        return channex.feedStatus === 200
          ? HttpResponse.json({
              meta: { total: channex.feed.length, page: 1, limit: 100 },
              data: channex.feed,
            })
          : HttpResponse.json({}, { status: channex.feedStatus });
      }),
      http.get(`${CHANNEX_BASE_URL}/api/v1/room_types/options`, () =>
        HttpResponse.json({
          data: [
            {
              type: 'room_type',
              id: DOBLE_TYPE,
              attributes: {
                id: DOBLE_TYPE,
                title: 'DOBLE',
                default_occupancy: 2,
              },
            },
            {
              type: 'room_type',
              id: SUITE_TYPE,
              attributes: {
                id: SUITE_TYPE,
                title: 'SUITE',
                default_occupancy: 2,
              },
            },
          ],
        }),
      ),
      http.post(
        `${CHANNEX_BASE_URL}/api/v1/availability`,
        async ({ request }) => {
          calls.push('availability');
          const body = (await request.json()) as { values: SentValue[] };
          availabilityCalls.push(body.values);
          return availabilityStatus === 200
            ? HttpResponse.json({ data: [], meta: { message: 'Success' } })
            : HttpResponse.json({}, { status: availabilityStatus });
        },
      ),
    );
    app = await startBookingFeedApp(clock);
    calls = [];
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

  const value = (
    room_type_id: string,
    date_from: string,
    date_to: string,
    availability: number,
  ): SentValue => ({
    property_id: PROPERTY_ID,
    room_type_id,
    date_from,
    date_to,
    availability,
  });

  it('lee el feed y después envía en un solo A4 los 90 días de las dos categorías, con la reserva que entró', async () => {
    // La reserva de Booking ocupa la 201 las noches del 10 y el 11.
    channex.feed = [aRevision(NEW_REVISION)];

    await expect(app.get(AriDailyJob).run()).resolves.toBe(true);

    expect(calls).toEqual(['feed', 'availability']);
    expect(availabilityCalls).toEqual([
      [
        value(DOBLE_TYPE, TODAY, TODAY, 3),
        value(DOBLE_TYPE, '2026-11-10', '2026-11-11', 2),
        value(DOBLE_TYPE, '2026-11-12', LAST_NIGHT, 3),
        value(SUITE_TYPE, TODAY, LAST_NIGHT, 1),
      ],
    ]);
    // La marca que dejó la reserva queda para el ciclo de 30 s: el envío de las 03:00 no la toca.
    expect(await marks()).toEqual([
      {
        category_room: 'DOBLE',
        date_from: '2026-11-10',
        date_to: '2026-11-12',
      },
    ]);
  });

  it('con Channex respondiendo 503, los 90 días de las dos categorías quedan como marcas', async () => {
    availabilityStatus = 503;

    await expect(app.get(AriDailyJob).run()).resolves.toBe(true);

    expect(availabilityCalls).toHaveLength(1);
    expect(await marks()).toEqual([
      { category_room: 'DOBLE', date_from: TODAY, date_to: LIMIT },
      { category_room: 'SUITE', date_from: TODAY, date_to: LIMIT },
    ]);
  });

  it('si el feed no se puede leer (503), no envía la disponibilidad y los 90 días quedan como marcas (FR-007)', async () => {
    channex.feedStatus = 503;

    await expect(app.get(AriDailyJob).run()).resolves.toBe(true);

    expect(calls).toEqual(['feed']);
    expect(await marks()).toEqual([
      { category_room: 'DOBLE', date_from: TODAY, date_to: LIMIT },
      { category_room: 'SUITE', date_from: TODAY, date_to: LIMIT },
    ]);
  });

  it('con el bloqueo de Channex ocupado espera; cuando se suelta, corre los tres pasos', async () => {
    // Otra tarea de Channex (otra conexión, como otra instancia) tiene el bloqueo.
    const holder: QueryRunner = dataSource.createQueryRunner();
    await holder.connect();
    try {
      await holder.query('SELECT pg_advisory_lock(hashtext($1))', [
        CHANNEX_SYNC_LOCK,
      ]);
      const running = app.get(AriDailyJob).run();
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      expect(calls).toEqual([]);

      await holder.query('SELECT pg_advisory_unlock(hashtext($1))', [
        CHANNEX_SYNC_LOCK,
      ]);

      await expect(running).resolves.toBe(true);
      expect(calls).toEqual(['feed', 'availability']);
    } finally {
      await holder.query('SELECT pg_advisory_unlock_all()');
      await holder.release();
    }
  }, 30_000);
});
