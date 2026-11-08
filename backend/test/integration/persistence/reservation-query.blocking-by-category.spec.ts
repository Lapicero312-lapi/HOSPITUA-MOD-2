import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  ReservationStatus,
  StayStatus,
} from '../../../src/domain/shared/enums.js';
import { TypeOrmReservationQuery } from '../../../src/infrastructure/out/persistence/repositories/reservation-query.repository.js';
import { TypeOrmReservationRepository } from '../../../src/infrastructure/out/persistence/repositories/reservation.repository.js';
import { aDirectReservation, aDirectRoom } from '../../support/builders.js';
import { openTestDataSource, truncateAllTables } from '../support/database.js';

// Ids fijos para comprobar el orden: ROOM_A < ROOM_B < ROOM_C.
const ROOM_A = '1a000000-0000-4000-8000-000000000001';
const ROOM_B = '2b000000-0000-4000-8000-000000000002';
const ROOM_C = '3c000000-0000-4000-8000-000000000003';

describe('TypeOrmReservationQuery.blockingRoomsByCategory contra PostgreSQL real (check-view-reservation, T016c)', () => {
  let dataSource: DataSource;
  let query: TypeOrmReservationQuery;
  let reservations: TypeOrmReservationRepository;

  /** Guarda una reserva directa con una habitación de esa categoría y esas fechas. */
  async function reserve({
    roomId,
    categoryRoom = 'DOBLE',
    startDate,
    endDate,
    status = 'ACTIVE',
    stayStatus = 'EXPECTED',
  }: {
    roomId: string;
    categoryRoom?: string;
    startDate: string;
    endDate: string;
    status?: ReservationStatus;
    stayStatus?: StayStatus;
  }): Promise<void> {
    await reservations.insert(
      aDirectReservation({
        startDate,
        endDate,
        status,
        rooms: [aDirectRoom({ roomId, categoryRoom, stayStatus })],
      }),
    );
  }

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    query = new TypeOrmReservationQuery(dataSource);
    reservations = new TypeOrmReservationRepository(dataSource);
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('da una entrada por noche de [dateFrom, dateTo): la estadía ocupa sus noches y no el día de salida', async () => {
    // Llega el 10 y sale el 12: ocupa las noches del 10 y del 11.
    await reserve({
      roomId: ROOM_A,
      startDate: '2026-11-10',
      endDate: '2026-11-12',
    });

    await expect(
      query.blockingRoomsByCategory('DOBLE', '2026-11-09', '2026-11-13'),
    ).resolves.toEqual([
      { date: '2026-11-09', roomIds: [] },
      { date: '2026-11-10', roomIds: [ROOM_A] },
      { date: '2026-11-11', roomIds: [ROOM_A] },
      { date: '2026-11-12', roomIds: [] },
    ]);
  });

  it('un rango que empieza a mitad de la estadía solo trae sus noches', async () => {
    await reserve({
      roomId: ROOM_A,
      startDate: '2026-11-10',
      endDate: '2026-11-13',
    });

    await expect(
      query.blockingRoomsByCategory('DOBLE', '2026-11-11', '2026-11-12'),
    ).resolves.toEqual([{ date: '2026-11-11', roomIds: [ROOM_A] }]);
  });

  it('cada noche trae las habitaciones ocupadas ordenadas, y una salida y una llegada el mismo día en la misma habitación cuentan una vez', async () => {
    await reserve({
      roomId: ROOM_C,
      startDate: '2026-11-10',
      endDate: '2026-11-12',
    });
    await reserve({
      roomId: ROOM_A,
      startDate: '2026-11-10',
      endDate: '2026-11-11',
    });
    // ROOM_A sale el 11 y la vuelve a ocupar otra reserva desde el 11.
    await reserve({
      roomId: ROOM_A,
      startDate: '2026-11-11',
      endDate: '2026-11-12',
    });
    await reserve({
      roomId: ROOM_B,
      startDate: '2026-11-11',
      endDate: '2026-11-12',
    });

    await expect(
      query.blockingRoomsByCategory('DOBLE', '2026-11-10', '2026-11-12'),
    ).resolves.toEqual([
      { date: '2026-11-10', roomIds: [ROOM_A, ROOM_C] },
      { date: '2026-11-11', roomIds: [ROOM_A, ROOM_B, ROOM_C] },
    ]);
  });

  it('solo cuenta la categoría pedida, la que guardó la reserva', async () => {
    await reserve({
      roomId: ROOM_A,
      startDate: '2026-11-10',
      endDate: '2026-11-11',
    });
    await reserve({
      roomId: ROOM_B,
      categoryRoom: 'SUITE',
      startDate: '2026-11-10',
      endDate: '2026-11-11',
    });

    await expect(
      query.blockingRoomsByCategory('SUITE', '2026-11-10', '2026-11-11'),
    ).resolves.toEqual([{ date: '2026-11-10', roomIds: [ROOM_B] }]);
  });

  describe('solo las habitaciones que ocupan inventario (blocks_inventory, como findBlockingRooms)', () => {
    it.each(['CANCELLED', 'NO_SHOW', 'COMPLETED'] as const)(
      'una reserva %s no ocupa la noche',
      async (status) => {
        await reserve({
          roomId: ROOM_A,
          startDate: '2026-11-10',
          endDate: '2026-11-11',
          status,
          stayStatus: status === 'COMPLETED' ? 'CHECKED_OUT' : 'EXPECTED',
        });

        await expect(
          query.blockingRoomsByCategory('DOBLE', '2026-11-10', '2026-11-11'),
        ).resolves.toEqual([{ date: '2026-11-10', roomIds: [] }]);
      },
    );

    it.each(['CHECKED_OUT', 'NOT_ARRIVED'] as const)(
      'una habitación %s de una reserva en curso no ocupa la noche',
      async (stayStatus) => {
        await reserve({
          roomId: ROOM_A,
          startDate: '2026-11-10',
          endDate: '2026-11-12',
          status: 'IN_PROGRESS',
          stayStatus,
        });

        await expect(
          query.blockingRoomsByCategory('DOBLE', '2026-11-10', '2026-11-11'),
        ).resolves.toEqual([{ date: '2026-11-10', roomIds: [] }]);
      },
    );

    it.each(['PENDING', 'ACTIVE', 'IN_PROGRESS'] as const)(
      'una reserva %s ocupa la noche',
      async (status) => {
        await reserve({
          roomId: ROOM_A,
          startDate: '2026-11-10',
          endDate: '2026-11-11',
          status,
        });

        await expect(
          query.blockingRoomsByCategory('DOBLE', '2026-11-10', '2026-11-11'),
        ).resolves.toEqual([{ date: '2026-11-10', roomIds: [ROOM_A] }]);
      },
    );
  });

  it('90 noches sin reservas dan 90 entradas vacías, de dateFrom a la víspera de dateTo', async () => {
    const nights = await query.blockingRoomsByCategory(
      'DOBLE',
      '2026-11-10',
      '2027-02-08',
    );

    expect(nights).toHaveLength(90);
    expect(nights[0]).toEqual({ date: '2026-11-10', roomIds: [] });
    expect(nights.at(-1)).toEqual({ date: '2027-02-07', roomIds: [] });
    expect(nights.every((night) => night.roomIds.length === 0)).toBe(true);
  });
});
