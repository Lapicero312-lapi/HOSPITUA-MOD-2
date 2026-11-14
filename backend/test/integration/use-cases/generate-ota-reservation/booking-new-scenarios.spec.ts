import type { INestApplication } from '@nestjs/common';
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
import type { Clock } from '../../../../src/application/ports/out/clock.js';
import {
  RESERVATION_REPOSITORY,
  type ReservationRepository,
} from '../../../../src/application/ports/out/reservation.repository.js';
import { Money } from '../../../../src/domain/shared/money.js';
import { ChannexSyncJob } from '../../../../src/infrastructure/in/jobs/channex-sync.job.js';
import { aDirectReservation, aDirectRoom } from '../../../support/builders.js';
import {
  aRevision,
  aSimulatedChannex,
  DOBLE_TYPE,
  type SimulatedChannex,
  simulate,
  startBookingFeedApp,
  SUITE_305,
  SUITE_TYPE,
  useBookingFeedEnv,
} from '../../support/booking-feed-app.js';
import {
  openTestDataSource,
  truncateAllTables,
} from '../../support/database.js';

const NEW_REVISION = '03dd7198-c5b7-493c-a889-74d0c2211de7';

/**
 * T008 de `generate-ota-reservation`: los escenarios 3 a 7 de la historia 1 (reservas nuevas de Booking), con
 * la aplicación completa, PostgreSQL real, y Channex y el Módulo 1 simulados en HTTP (msw). Cada ciclo es
 * una ejecución de `ChannexSyncJob`, como la del intervalo. Los escenarios 1, 2, 6 (tipo sin relación) y 8
 * están en `process-booking-feed.spec.ts` (T006 y T011c).
 */
describe('generate-ota-reservation: reservas nuevas de Booking (T008, escenarios 3 a 7)', () => {
  const server = setupServer();
  let dataSource: DataSource;
  let app: INestApplication;
  let channex: SimulatedChannex;
  const now = new Date('2026-11-09T15:00:00.000Z');
  const clock: Clock = { now: () => now, today: () => '2026-11-09' };

  /** Un ciclo de la tarea de Channex. */
  const cycle = async () => {
    await expect(app.get(ChannexSyncJob).run()).resolves.toBe(true);
  };

  const mapType = (type: string, category: string) =>
    dataSource.query(
      `INSERT INTO ota_room_type_mapping (channex_room_type_id, category_room, count_of_rooms, occupancy)
       VALUES ($1, $2, 2, 2)`,
      [type, category],
    );

  const bookingReservations = (): Promise<
    { status: string; conflict_reason: string | null }[]
  > =>
    dataSource.query(
      `SELECT status, conflict_reason FROM reservation WHERE source = 'OTA'`,
    );

  const bookingRooms = (): Promise<
    {
      room_number: string | null;
      guest_count: number;
      stay_status: string;
      blocks_inventory: boolean;
    }[]
  > =>
    dataSource.query(
      `SELECT rr.room_number, rr.guest_count, rr.stay_status, rr.blocks_inventory
       FROM reservation_room rr JOIN reservation r ON r.id = rr.reservation_id
       WHERE r.source = 'OTA' ORDER BY rr.room_number NULLS LAST`,
    );

  const revisions = (): Promise<{ result: string; acked: boolean }[]> =>
    dataSource.query(
      `SELECT result, acked_at IS NOT NULL AS acked FROM ota_booking_revision`,
    );

  /** Otra reserva (directa) que ocupa la habitación en las fechas de la revisión. */
  const occupy = (room: Room) =>
    app.get<ReservationRepository>(RESERVATION_REPOSITORY).insert(
      aDirectReservation({
        startDate: '2026-11-10',
        endDate: '2026-11-12',
        rooms: [
          aDirectRoom({
            roomId: room.id,
            roomNumber: room.roomNumber,
            categoryRoom: room.categoryRoom,
            guestCount: 1,
            rate: {
              roomGrossAmount: Money.of('100000.00', 'COP'),
              quoteId: `Q-${room.roomNumber}`,
            },
          }),
        ],
      }),
    );

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    useBookingFeedEnv();
    server.listen({ onUnhandledRequest: 'bypass' });
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    channex = aSimulatedChannex();
    simulate(server, channex);
    app = await startBookingFeedApp(clock);
  });

  afterEach(async () => {
    await app.close();
    server.resetHandlers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    server.close();
    await truncateAllTables(dataSource);
    await dataSource.destroy();
  });

  it('escenario 3: dos habitaciones de DOBLE con la 201, la 202 y la 203 libres: una sola reserva con la 201 y la 202', async () => {
    await mapType(DOBLE_TYPE, 'DOBLE');
    channex.feed = [aRevision(NEW_REVISION, {}, [{}, {}])];

    await cycle();

    expect(await bookingReservations()).toEqual([
      { status: 'ACTIVE', conflict_reason: null },
    ]);
    expect(
      (await bookingRooms()).map(({ room_number }) => room_number),
    ).toEqual(['201', '202']);
    expect(await revisions()).toEqual([{ result: 'APPLIED', acked: true }]);
  });

  it('escenario 4: SUITE con su única habitación ocupada: la reserva ACTIVE sin asignar, NO_ROOM_AVAILABLE y el ack', async () => {
    await mapType(SUITE_TYPE, 'SUITE');
    await occupy(SUITE_305);
    channex.feed = [
      aRevision(NEW_REVISION, {}, [{ room_type_id: SUITE_TYPE }]),
    ];

    await cycle();

    expect(await bookingReservations()).toEqual([
      { status: 'ACTIVE', conflict_reason: 'NO_ROOM_AVAILABLE' },
    ]);
    expect(await bookingRooms()).toEqual([
      {
        room_number: null,
        guest_count: 2,
        stay_status: 'EXPECTED',
        blocks_inventory: false,
      },
    ]);
    expect(await revisions()).toEqual([{ result: 'CONFLICT', acked: true }]);
    expect(channex.acks).toEqual([NEW_REVISION]);
  });

  it('escenario 5: 3 personas en una categoría de capacidad 2: la reserva con CAPACITY_EXCEEDED y el ack', async () => {
    await mapType(DOBLE_TYPE, 'DOBLE');
    channex.feed = [
      aRevision(NEW_REVISION, {}, [
        { occupancy: { adults: 2, children: 1, infants: 1 } },
      ]),
    ];

    await cycle();

    expect(await bookingReservations()).toEqual([
      { status: 'ACTIVE', conflict_reason: 'CAPACITY_EXCEEDED' },
    ]);
    // Los bebés no se cuentan: 2 adultos y 1 niño.
    expect(await bookingRooms()).toEqual([
      expect.objectContaining({ room_number: '201', guest_count: 3 }),
    ]);
    expect(await revisions()).toEqual([{ result: 'CONFLICT', acked: true }]);
  });

  it('escenario 6: una habitación sin tipo de Channex (no mapeada en Channex): nada guardado y sin ack, en cada ciclo', async () => {
    await mapType(DOBLE_TYPE, 'DOBLE');
    channex.feed = [aRevision(NEW_REVISION, {}, [{ room_type_id: null }])];

    await cycle();
    await cycle();

    expect(await bookingReservations()).toEqual([]);
    expect(await revisions()).toEqual([]);
    expect(channex.acks).toEqual([]);
    expect(channex.feedReads).toBe(2);
  });

  it('escenario 7: Channex no responde (503): nada registrado en esa lectura; en la siguiente, la reserva y el ack', async () => {
    await mapType(DOBLE_TYPE, 'DOBLE');
    channex.feed = [aRevision(NEW_REVISION)];
    channex.feedStatus = 503;

    await cycle();

    expect(await bookingReservations()).toEqual([]);
    expect(channex.acks).toEqual([]);

    channex.feedStatus = 200;
    await cycle();

    expect(await bookingReservations()).toHaveLength(1);
    expect(channex.acks).toEqual([NEW_REVISION]);
  });

  it('escenario 7: Channex responde 429: nada registrado y pausa de un minuto sin llamarlo; pasado el minuto, lee y registra', async () => {
    await mapType(DOBLE_TYPE, 'DOBLE');
    channex.feed = [aRevision(NEW_REVISION)];
    channex.feedStatus = 429;
    // Solo la fecha es falsa, y desde que arranca la aplicación: la pausa de Channex toma `Date.now` al
    // crearse. La fecha sigue corriendo; la prueba la adelanta cuando hace falta.
    await app.close();
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
    app = await startBookingFeedApp(clock);

    await cycle();
    expect(channex.feedReads).toBe(1);
    expect(await bookingReservations()).toEqual([]);

    // Dentro de la pausa, el ciclo no llama a Channex.
    channex.feedStatus = 200;
    vi.setSystemTime(Date.now() + 30_000);
    await cycle();
    expect(channex.feedReads).toBe(1);
    expect(await bookingReservations()).toEqual([]);

    // Pasado el minuto, lee el feed y registra la reserva.
    vi.setSystemTime(Date.now() + 31_000);
    await cycle();
    expect(channex.feedReads).toBe(2);
    expect(await bookingReservations()).toHaveLength(1);
    expect(channex.acks).toEqual([NEW_REVISION]);
  });
});
