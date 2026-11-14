import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
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
import type { Room } from '../../../../src/application/integration/room.js';
import {
  CLOCK,
  type Clock,
} from '../../../../src/application/ports/out/clock.js';
import { configureApp } from '../../../../src/configure-app.js';
import { ChannexSetupJob } from '../../../../src/infrastructure/in/jobs/channex-setup.job.js';
import { ChannexSyncJob } from '../../../../src/infrastructure/in/jobs/channex-sync.job.js';
import {
  integrationEnv,
  openTestDataSource,
  truncateAllTables,
} from '../../support/database.js';

/** Channex y el Módulo 1 simulados. La clave es de prueba: nunca se llama al Channex real. */
const CHANNEX_BASE_URL = 'http://channex.test';
const MODULE1_BASE_URL = 'http://module1.test';
const PROPERTY_ID = '716305c4-561a-4561-a187-7f5b8aeb5920';
const API_KEY = 'clave-de-prueba';

/** El tipo de habitación de Channex de la categoría DOBLE (la fila la crea la prueba: falta SyncRoomTypes). */
const DOBLE_TYPE = '994d1375-dbbd-4072-8724-b2ab32ce781b';
const BOOKING_ID = 'cfa33f3b-bd32-4b90-8ef9-bde2bfe986cd';
const NEW_REVISION = '03dd7198-c5b7-493c-a889-74d0c2211de7';
const CANCEL_REVISION = '7a1c2e3f-4b5d-4c6e-8f70-81a2b3c4d5e6';

const ROOM_201: Room = {
  id: '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c01',
  roomNumber: '201',
  categoryRoom: 'DOBLE',
  maxCapacity: 2,
};
const ROOM_202: Room = {
  id: '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c02',
  roomNumber: '202',
  categoryRoom: 'DOBLE',
  maxCapacity: 2,
};

/** La revisión del ejemplo de A1 del plan, en el formato del feed de Channex. */
const aRevision = (
  id: string,
  attributes: Record<string, unknown> = {},
  room: Record<string, unknown> = {},
) => ({
  type: 'booking_revision',
  id,
  attributes: {
    id,
    booking_id: BOOKING_ID,
    ota_reservation_code: '9996013801',
    ota_name: 'Booking.com',
    status: 'new',
    arrival_date: '2026-11-10',
    departure_date: '2026-11-12',
    amount: '220.00',
    ota_commission: '33.00',
    currency: 'USD',
    notes: 'Llegada tarde',
    customer: {
      name: 'Ana',
      surname: 'Pérez',
      mail: 'ana@correo.com',
      phone: '+57 300 000 0000',
      country: 'CO',
    },
    rooms: [
      {
        room_type_id: DOBLE_TYPE,
        rate_plan_id: '445835fb-7956-42ac-9efc-3e6f331f0808',
        checkin_date: '2026-11-10',
        checkout_date: '2026-11-12',
        occupancy: { adults: 2, children: 0, infants: 0 },
        ...room,
      },
    ],
    ...attributes,
  },
});

const server = setupServer();

/**
 * T006, T007, T010 y T011c de `generate-ota-reservation`: `ChannexSyncJob` lee el feed y
 * `ProcessBookingFeed` procesa cada revisión con `ProcessBookingRevision`, con la aplicación completa,
 * PostgreSQL real, y Channex y el Módulo 1 simulados en HTTP (msw).
 */
describe('ProcessBookingFeed y ProcessBookingRevision contra PostgreSQL real (generate-ota-reservation)', () => {
  let dataSource: DataSource;
  let app: INestApplication;
  /** Lo que trae el feed en el próximo ciclo. */
  let feed: unknown[];
  /** Los `ack` que recibió Channex, por id de revisión. */
  let acks: string[];
  let ackFails: boolean;
  const now = new Date('2026-11-09T15:00:00.000Z');
  const clock: Clock = { now: () => now, today: () => '2026-11-09' };

  const cycle = async () => {
    await expect(app.get(ChannexSyncJob).run()).resolves.toBe(true);
  };

  const mapDobleType = () =>
    dataSource.query(
      `INSERT INTO ota_room_type_mapping (channex_room_type_id, category_room, count_of_rooms, occupancy)
       VALUES ($1, 'DOBLE', 2, 2)`,
      [DOBLE_TYPE],
    );

  const reservations = (): Promise<
    {
      reservation_ref: string;
      status: string;
      source: string;
      external_confirmation_code: string;
      gross_amount: string;
      currency: string;
      commission_percentage: string;
      commission_amount: string;
      conflict_reason: string | null;
      start_date: string;
      end_date: string;
    }[]
  > =>
    dataSource.query(
      `SELECT reservation_ref, status, source, external_confirmation_code, gross_amount::text,
              currency, commission_percentage::text, commission_amount::text, conflict_reason,
              to_char(start_date, 'YYYY-MM-DD') AS start_date, to_char(end_date, 'YYYY-MM-DD') AS end_date
       FROM reservation`,
    );

  const rooms = (): Promise<
    { room_number: string | null; stay_status: string }[]
  > =>
    dataSource.query(
      'SELECT room_number, stay_status FROM reservation_room ORDER BY room_number',
    );

  const revisions = (): Promise<
    { revision_id: string; status: string; result: string; acked: boolean }[]
  > =>
    dataSource.query(
      `SELECT revision_id::text, status, result, acked_at IS NOT NULL AS acked
       FROM ota_booking_revision ORDER BY processed_at`,
    );

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    // Antes de importar AppModule: AppConfigModule lee el entorno al importarse. El intervalo largo evita
    // que la tarea corra sola durante la prueba; cada ciclo lo dispara la prueba.
    Object.assign(process.env, {
      NODE_ENV: 'test',
      ...integrationEnv(),
      CHANNEX_BASE_URL,
      CHANNEX_API_KEY: API_KEY,
      CHANNEX_PROPERTY_ID: PROPERTY_ID,
      CHANNEX_SYNC_INTERVAL_SECONDS: '3600',
      MODULE1_BASE_URL,
    });
    // Una llamada a Channex o al Módulo 1 sin respuesta simulada es un error de la prueba.
    server.listen({
      onUnhandledRequest: (sent, print) => {
        const { origin } = new URL(sent.url);
        if (origin === CHANNEX_BASE_URL || origin === MODULE1_BASE_URL) {
          print.error();
        }
      },
    });
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    feed = [];
    acks = [];
    ackFails = false;
    server.use(
      // A0 de configure-ota: la propiedad está en la cuenta, así que el arranque queda listo.
      http.get(`${CHANNEX_BASE_URL}/api/v1/properties/options`, () =>
        HttpResponse.json({
          data: [
            {
              type: 'property',
              id: PROPERTY_ID,
              attributes: { id: PROPERTY_ID, title: 'Hotel de prueba' },
            },
          ],
        }),
      ),
      http.get(`${CHANNEX_BASE_URL}/api/v1/booking_revisions/feed`, () =>
        HttpResponse.json({
          meta: { total: feed.length, page: 1, limit: 100 },
          data: feed,
        }),
      ),
      http.post(
        `${CHANNEX_BASE_URL}/api/v1/booking_revisions/:id/ack`,
        ({ params }) => {
          acks.push(String(params.id));
          return ackFails
            ? HttpResponse.json({}, { status: 503 })
            : HttpResponse.json({ data: {} });
        },
      ),
      // El Módulo 1: la 201 y la 202 de DOBLE, sin mantenimientos.
      http.get(`${MODULE1_BASE_URL}/api/rooms`, () =>
        HttpResponse.json([ROOM_201, ROOM_202]),
      ),
      http.get(
        `${MODULE1_BASE_URL}/api/rooms/:roomId/maintenances`,
        ({ params }) =>
          HttpResponse.json({
            roomId: params.roomId,
            available: true,
            conflicts: [],
          }),
      ),
    );
    const attempt = vi.spyOn(ChannexSetupJob.prototype, 'attempt');
    const { AppModule } = await import('../../../../src/app.module.js');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CLOCK)
      .useValue(clock)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    await expect(attempt.mock.results[0].value).resolves.toBe('READY');
    attempt.mockRestore();
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

  it('una reserva nueva: ACTIVE, el código, el valor, la 201 en EXPECTED, la comisión y el ack', async () => {
    await mapDobleType();
    feed = [aRevision(NEW_REVISION)];

    await cycle();

    expect(await reservations()).toEqual([
      expect.objectContaining({
        status: 'ACTIVE',
        source: 'OTA',
        external_confirmation_code: '9996013801',
        gross_amount: '220.00',
        currency: 'USD',
        commission_percentage: '15.00',
        commission_amount: '33.00',
        conflict_reason: null,
      }),
    ]);
    expect(await rooms()).toEqual([
      { room_number: '201', stay_status: 'EXPECTED' },
    ]);
    expect(acks).toEqual([NEW_REVISION]);
    expect(await revisions()).toEqual([
      {
        revision_id: NEW_REVISION,
        status: 'new',
        result: 'APPLIED',
        acked: true,
      },
    ]);
  });

  it('la misma revisión en el ciclo siguiente: una sola reserva y otro ack, sin cambios', async () => {
    await mapDobleType();
    feed = [aRevision(NEW_REVISION)];
    await cycle();

    await cycle();

    expect(await reservations()).toHaveLength(1);
    expect(acks).toEqual([NEW_REVISION, NEW_REVISION]);
    expect(await revisions()).toHaveLength(1);
  });

  it('un tipo sin relación con una categoría: nada guardado y sin ack; cuando se relaciona, se guarda', async () => {
    feed = [aRevision(NEW_REVISION)];

    await cycle();

    expect(await reservations()).toEqual([]);
    expect(await revisions()).toEqual([]);
    expect(acks).toEqual([]);

    await mapDobleType();
    await cycle();

    expect(await reservations()).toHaveLength(1);
    expect(acks).toEqual([NEW_REVISION]);
  });

  it('T011c: una habitación con otras fechas: las de la reserva, CHANGE_NOT_APPLICABLE, CONFLICT y el ack', async () => {
    await mapDobleType();
    feed = [aRevision(NEW_REVISION, {}, { checkout_date: '2026-11-11' })];

    await cycle();

    expect(await reservations()).toEqual([
      expect.objectContaining({
        start_date: '2026-11-10',
        end_date: '2026-11-12',
        conflict_reason: 'CHANGE_NOT_APPLICABLE',
      }),
    ]);
    expect(await revisions()).toEqual([
      expect.objectContaining({ result: 'CONFLICT', acked: true }),
    ]);
  });

  it('T010: la cancelación de Booking: CANCELLED, su Cancellation con OTA_API y Booking.com, la comisión intacta y el ack', async () => {
    await mapDobleType();
    feed = [aRevision(NEW_REVISION)];
    await cycle();

    feed = [aRevision(CANCEL_REVISION, { status: 'cancelled' })];
    await cycle();

    expect(await reservations()).toEqual([
      expect.objectContaining({
        status: 'CANCELLED',
        commission_percentage: '15.00',
        commission_amount: '33.00',
      }),
    ]);
    expect(
      await dataSource.query(
        'SELECT channel, processed_by, reason FROM cancellation',
      ),
    ).toEqual([
      { channel: 'OTA_API', processed_by: 'Booking.com', reason: null },
    ]);
    expect(await revisions()).toEqual([
      expect.objectContaining({ revision_id: NEW_REVISION, result: 'APPLIED' }),
      expect.objectContaining({
        revision_id: CANCEL_REVISION,
        status: 'cancelled',
        result: 'APPLIED',
        acked: true,
      }),
    ]);
  });

  it('T010: una cancelación de una reserva que no existe: IGNORED y el ack', async () => {
    feed = [aRevision(CANCEL_REVISION, { status: 'cancelled' })];

    await cycle();

    expect(await reservations()).toEqual([]);
    expect(await revisions()).toEqual([
      expect.objectContaining({ result: 'IGNORED', acked: true }),
    ]);
  });

  it('T007: si el ack falla, la revisión queda guardada sin acked_at y el ack se repite en el ciclo siguiente', async () => {
    await mapDobleType();
    feed = [aRevision(NEW_REVISION)];
    ackFails = true;

    await cycle();

    expect(await reservations()).toHaveLength(1);
    expect(await revisions()).toEqual([
      expect.objectContaining({ acked: false }),
    ]);

    ackFails = false;
    feed = [];
    await cycle();

    expect(acks).toEqual([NEW_REVISION, NEW_REVISION]);
    expect(await revisions()).toEqual([
      expect.objectContaining({ acked: true }),
    ]);
    expect(await reservations()).toHaveLength(1);
  });
});
