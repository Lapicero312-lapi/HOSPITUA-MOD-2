import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { randomUUID } from 'node:crypto';
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
import {
  RESERVATION_REPOSITORY,
  type ReservationRepository,
} from '../../../../src/application/ports/out/reservation.repository.js';
import {
  PROCESS_CHECK_IN,
  type ProcessCheckIn,
} from '../../../../src/application/use-cases/update-reservation/ports/in/process-check-in.port.js';
import { configureApp } from '../../../../src/configure-app.js';
import { Money } from '../../../../src/domain/shared/money.js';
import { INBOUND_QUEUES } from '../../../../src/infrastructure/config/rabbitmq.topology.js';
import { aDirectReservation, aDirectRoom } from '../../../support/builders.js';
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
const MODIFIED_REVISION = '5b6c7d8e-9f0a-4b1c-8d2e-3f4a5b6c7d8e';
const SECOND_CANCEL_REVISION = '2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f';

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
 * T011 de `generate-ota-reservation`: los escenarios 1 a 5 de la historia 2 (cambios y cancelaciones de
 * Booking), con la aplicación completa, PostgreSQL real, y Channex y el Módulo 1 simulados en HTTP (msw).
 * Cada prueba crea primero la reserva con su revisión `new` y después envía el cambio o la cancelación en
 * el ciclo siguiente de `ChannexSyncJob`, como lo haría el feed.
 */
describe('generate-ota-reservation: cambios y cancelaciones de Booking (T011, escenarios 1 a 5 de la historia 2)', () => {
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

  /** La reserva de Booking del ejemplo de A1 (la 201, 220 USD con 15 %), creada por su revisión `new`. */
  const bookedThroughFeed = async () => {
    await mapDobleType();
    feed = [aRevision(NEW_REVISION)];
    await cycle();
  };

  const revisionOf = (id: string) =>
    revisions().then((rows) => rows.find((row) => row.revision_id === id));

  /** Otra reserva (directa) que ocupa la habitación en esas fechas. */
  const occupy = (room: Room, startDate: string, endDate: string) =>
    app.get<ReservationRepository>(RESERVATION_REPOSITORY).insert(
      aDirectReservation({
        startDate,
        endDate,
        rooms: [
          aDirectRoom({
            roomId: room.id,
            roomNumber: room.roomNumber,
            categoryRoom: 'DOBLE',
            guestCount: 1,
            rate: {
              roomGrossAmount: Money.of('100000.00', 'COP'),
              quoteId: `Q-${room.roomNumber}`,
            },
          }),
        ],
      }),
    );

  /** El Check-In de la 201 de la reserva de Booking: queda `IN_PROGRESS`. */
  const checkIn = async () => {
    const [{ reservation_ref }] = await reservations();
    await expect(
      app.get<ProcessCheckIn>(PROCESS_CHECK_IN).execute({
        messageId: randomUUID(),
        sequenceNumber: 1,
        queue: INBOUND_QUEUES.CHECK_IN.name,
        reservationRef: reservation_ref,
        roomId: ROOM_201.id,
        movementDate: '2026-11-10',
        guests: [
          {
            firstName: 'Ana',
            lastName: 'Pérez',
            documentType: 'CC',
            documentNumber: '52123456',
            birthDate: '1990-05-12',
            nationality: 'Colombia',
          },
        ],
      }),
    ).resolves.toBe('APPLIED');
  };

  it('escenario 1: cambio de fechas: la salida, el valor y la comisión nuevos (porcentaje congelado), la 201 conservada, APPLIED y el ack', async () => {
    await bookedThroughFeed();

    feed = [
      aRevision(
        MODIFIED_REVISION,
        { status: 'modified', departure_date: '2026-11-13', amount: '300.00' },
        { checkout_date: '2026-11-13' },
      ),
    ];
    await cycle();

    expect(await reservations()).toEqual([
      expect.objectContaining({
        status: 'ACTIVE',
        start_date: '2026-11-10',
        end_date: '2026-11-13',
        gross_amount: '300.00',
        currency: 'USD',
        commission_percentage: '15.00',
        commission_amount: '45.00',
        conflict_reason: null,
      }),
    ]);
    expect(await rooms()).toEqual([
      { room_number: '201', stay_status: 'EXPECTED' },
    ]);
    expect(await revisionOf(MODIFIED_REVISION)).toEqual({
      revision_id: MODIFIED_REVISION,
      status: 'modified',
      result: 'APPLIED',
      acked: true,
    });
    expect(acks).toEqual([NEW_REVISION, MODIFIED_REVISION]);
    // La comisión recalculada deja su auditoría, además de la del alta.
    expect(
      await dataSource.query(
        'SELECT commission_amount::text AS amount FROM commission_audit ORDER BY commission_amount',
      ),
    ).toEqual([{ amount: '33.00' }, { amount: '45.00' }]);
  });

  it('escenario 2: cambio sin disponibilidad: las fechas nuevas, la habitación sin asignar, NO_ROOM_AVAILABLE, CONFLICT y el ack', async () => {
    await bookedThroughFeed();
    // La 201 y la 202 están ocupadas la noche que se agrega.
    await occupy(ROOM_201, '2026-11-12', '2026-11-13');
    await occupy(ROOM_202, '2026-11-12', '2026-11-13');

    feed = [
      aRevision(
        MODIFIED_REVISION,
        { status: 'modified', departure_date: '2026-11-13' },
        { checkout_date: '2026-11-13' },
      ),
    ];
    await cycle();

    const booking = (await reservations()).find(
      ({ source }) => source === 'OTA',
    );
    expect(booking).toEqual(
      expect.objectContaining({
        status: 'ACTIVE',
        end_date: '2026-11-13',
        conflict_reason: 'NO_ROOM_AVAILABLE',
      }),
    );
    expect(
      await dataSource.query(
        `SELECT rr.room_number, rr.blocks_inventory FROM reservation_room rr
         JOIN reservation r ON r.id = rr.reservation_id WHERE r.source = 'OTA'`,
      ),
    ).toEqual([{ room_number: null, blocks_inventory: false }]);
    expect(await revisionOf(MODIFIED_REVISION)).toEqual(
      expect.objectContaining({ result: 'CONFLICT', acked: true }),
    );
  });

  it('FR-012 en un cambio: una habitación con otras fechas: las de la reserva, CHANGE_NOT_APPLICABLE y CONFLICT', async () => {
    await bookedThroughFeed();

    feed = [
      aRevision(
        MODIFIED_REVISION,
        { status: 'modified', amount: '250.00' },
        { checkout_date: '2026-11-11' },
      ),
    ];
    await cycle();

    expect(await reservations()).toEqual([
      expect.objectContaining({
        start_date: '2026-11-10',
        end_date: '2026-11-12',
        gross_amount: '250.00',
        conflict_reason: 'CHANGE_NOT_APPLICABLE',
      }),
    ]);
    expect(await revisionOf(MODIFIED_REVISION)).toEqual(
      expect.objectContaining({ result: 'CONFLICT', acked: true }),
    );
  });

  it('escenario 3: cancelación: CANCELLED con su Cancellation de OTA_API, la comisión intacta, APPLIED y el ack', async () => {
    await bookedThroughFeed();

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
      await dataSource.query('SELECT channel, processed_by FROM cancellation'),
    ).toEqual([{ channel: 'OTA_API', processed_by: 'Booking.com' }]);
    expect(await revisionOf(CANCEL_REVISION)).toEqual(
      expect.objectContaining({ result: 'APPLIED', acked: true }),
    );
  });

  it.each([
    [
      'un cambio',
      () =>
        aRevision(
          MODIFIED_REVISION,
          {
            status: 'modified',
            departure_date: '2026-11-13',
            amount: '300.00',
          },
          { checkout_date: '2026-11-13' },
        ),
    ],
    [
      'una cancelación',
      () => aRevision(CANCEL_REVISION, { status: 'cancelled' }),
    ],
  ])(
    'escenario 4: %s de una reserva en curso: no la cambia, CHANGE_NOT_APPLICABLE, CONFLICT y el ack',
    async (_case, revision) => {
      await bookedThroughFeed();
      await checkIn();
      const [before] = await reservations();

      const sent = revision();
      feed = [sent];
      await cycle();

      expect(await reservations()).toEqual([
        {
          ...before,
          conflict_reason: 'CHANGE_NOT_APPLICABLE',
        },
      ]);
      expect(await rooms()).toEqual([
        { room_number: '201', stay_status: 'CHECKED_IN' },
      ]);
      expect(await dataSource.query('SELECT 1 FROM cancellation')).toEqual([]);
      expect(await revisionOf(sent.id)).toEqual(
        expect.objectContaining({ result: 'CONFLICT', acked: true }),
      );
    },
  );

  it('escenario 5: otra cancelación de una reserva ya cancelada: sin cambios, IGNORED y el ack', async () => {
    await bookedThroughFeed();
    feed = [aRevision(CANCEL_REVISION, { status: 'cancelled' })];
    await cycle();
    const [before] = await reservations();

    feed = [aRevision(SECOND_CANCEL_REVISION, { status: 'cancelled' })];
    await cycle();

    expect(await reservations()).toEqual([before]);
    expect(
      await dataSource.query('SELECT count(*)::int AS total FROM cancellation'),
    ).toEqual([{ total: 1 }]);
    expect(await revisionOf(SECOND_CANCEL_REVISION)).toEqual(
      expect.objectContaining({ result: 'IGNORED', acked: true }),
    );
    expect(acks).toContain(SECOND_CANCEL_REVISION);
  });
});
