import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ReservationProps } from '../../../src/domain/reservation/reservation.js';
import {
  RESERVATION_STATUSES,
  type ReservationStatus,
} from '../../../src/domain/shared/enums.js';
import { TypeOrmReservationQuery } from '../../../src/infrastructure/out/persistence/repositories/reservation-query.repository.js';
import { TypeOrmReservationRepository } from '../../../src/infrastructure/out/persistence/repositories/reservation.repository.js';
import { aDirectReservation, aDirectRoom } from '../../support/builders.js';
import { openTestDataSource, truncateAllTables } from '../support/database.js';

const DAY = '2026-10-09';
const BEFORE = '2026-10-07';
const NEXT = '2026-10-10';
const AFTER = '2026-10-11';

const ARRIVING: readonly ReservationStatus[] = ['ACTIVE', 'PENDING'];
const DEPARTING: readonly ReservationStatus[] = ['IN_PROGRESS'];

const othersThan = (counted: readonly ReservationStatus[]) =>
  RESERVATION_STATUSES.filter((status) => !counted.includes(status));

describe('TypeOrmReservationQuery.countExpectedArrivalsAndDepartures contra PostgreSQL real (check-view-reservation, C2, T012)', () => {
  let dataSource: DataSource;
  let query: TypeOrmReservationQuery;
  let reservations: TypeOrmReservationRepository;

  const reservation = (changes: Partial<ReservationProps>) =>
    reservations.insert(aDirectReservation(changes));

  /** Llega el día `DAY` y sale después. */
  const arriving = (
    status: ReservationStatus,
    changes: Partial<ReservationProps> = {},
  ) => reservation({ status, startDate: DAY, endDate: AFTER, ...changes });

  /** Llegó antes y sale el día `DAY`. */
  const departing = (
    status: ReservationStatus,
    changes: Partial<ReservationProps> = {},
  ) => reservation({ status, startDate: BEFORE, endDate: DAY, ...changes });

  const count = () => query.countExpectedArrivalsAndDepartures(DAY);

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

  it('sin reservas, las dos cifras son 0', async () => {
    await expect(count()).resolves.toEqual({
      expectedArrivals: 0,
      expectedDepartures: 0,
    });
  });

  describe('llegadas: ACTIVE o PENDING con startDate igual al día', () => {
    it.each(ARRIVING)('cuenta una reserva %s', async (status) => {
      await arriving(status);

      await expect(count()).resolves.toEqual({
        expectedArrivals: 1,
        expectedDepartures: 0,
      });
    });

    it.each(othersThan(ARRIVING))(
      'no cuenta una reserva %s',
      async (status) => {
        await arriving(status);

        await expect(count()).resolves.toMatchObject({ expectedArrivals: 0 });
      },
    );

    it('no cuenta las que llegan otro día', async () => {
      await reservation({
        status: 'ACTIVE',
        startDate: BEFORE,
        endDate: AFTER,
      });
      await reservation({ status: 'ACTIVE', startDate: NEXT, endDate: AFTER });

      await expect(count()).resolves.toMatchObject({ expectedArrivals: 0 });
    });

    it('una reserva de 3 habitaciones es una sola llegada', async () => {
      await arriving('ACTIVE', {
        rooms: [
          aDirectRoom({ roomNumber: '201' }),
          aDirectRoom({ roomNumber: '202' }),
          aDirectRoom({ roomNumber: '203' }),
        ],
      });

      await expect(count()).resolves.toMatchObject({ expectedArrivals: 1 });
    });

    it('suma las ACTIVE y las PENDING', async () => {
      await arriving('ACTIVE');
      await arriving('ACTIVE');
      await arriving('PENDING');

      await expect(count()).resolves.toMatchObject({ expectedArrivals: 3 });
    });
  });

  describe('salidas: IN_PROGRESS con endDate igual al día', () => {
    it('cuenta una reserva IN_PROGRESS', async () => {
      await departing('IN_PROGRESS');

      await expect(count()).resolves.toEqual({
        expectedArrivals: 0,
        expectedDepartures: 1,
      });
    });

    it.each(othersThan(DEPARTING))(
      'no cuenta una reserva %s',
      async (status) => {
        await departing(status);

        await expect(count()).resolves.toMatchObject({ expectedDepartures: 0 });
      },
    );

    it('no cuenta las que salen después ni las que debían salir antes', async () => {
      await reservation({
        status: 'IN_PROGRESS',
        startDate: BEFORE,
        endDate: NEXT,
      });
      await reservation({
        status: 'IN_PROGRESS',
        startDate: '2026-10-05',
        endDate: BEFORE,
      });

      await expect(count()).resolves.toMatchObject({ expectedDepartures: 0 });
    });

    it('una reserva de 3 habitaciones es una sola salida', async () => {
      await departing('IN_PROGRESS', {
        rooms: [
          aDirectRoom({ roomNumber: '201', stayStatus: 'CHECKED_IN' }),
          aDirectRoom({ roomNumber: '202', stayStatus: 'CHECKED_IN' }),
          aDirectRoom({ roomNumber: '203', stayStatus: 'CHECKED_IN' }),
        ],
      });

      await expect(count()).resolves.toMatchObject({ expectedDepartures: 1 });
    });
  });

  it('cuenta las llegadas y las salidas del mismo día por separado', async () => {
    await arriving('ACTIVE');
    await arriving('PENDING');
    await departing('IN_PROGRESS');

    await expect(count()).resolves.toEqual({
      expectedArrivals: 2,
      expectedDepartures: 1,
    });
  });
});
