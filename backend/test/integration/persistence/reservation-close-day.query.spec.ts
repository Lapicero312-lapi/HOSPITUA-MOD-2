import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ReservationProps } from '../../../src/domain/reservation/reservation.js';
import type { ReservationStatus } from '../../../src/domain/shared/enums.js';
import { TypeOrmReservationQuery } from '../../../src/infrastructure/out/persistence/repositories/reservation-query.repository.js';
import { TypeOrmReservationRepository } from '../../../src/infrastructure/out/persistence/repositories/reservation.repository.js';
import { aDirectReservation, aDirectRoom } from '../../support/builders.js';
import { openTestDataSource, truncateAllTables } from '../support/database.js';

/** El día que se cierra, el anterior y el siguiente. */
const DAY = '2026-10-09';
const BEFORE = '2026-10-08';
const NEXT = '2026-10-10';

/** El `stayStatus` de la habitación que corresponde al estado de la reserva. */
const STAY_OF: Record<
  ReservationStatus,
  'EXPECTED' | 'CHECKED_IN' | 'CHECKED_OUT' | 'NOT_ARRIVED'
> = {
  PENDING: 'EXPECTED',
  ACTIVE: 'EXPECTED',
  IN_PROGRESS: 'CHECKED_IN',
  COMPLETED: 'CHECKED_OUT',
  CANCELLED: 'EXPECTED',
  NO_SHOW: 'NOT_ARRIVED',
};

describe('TypeOrmReservationQuery.findToClose contra PostgreSQL real (update-reservation, punto 13, T021)', () => {
  let dataSource: DataSource;
  let query: TypeOrmReservationQuery;
  let reservations: TypeOrmReservationRepository;

  /** Una reserva guardada en ese estado que llega `startDate`; devuelve su referencia. */
  const stored = async (
    status: ReservationStatus,
    startDate: string = DAY,
    changes: Partial<ReservationProps> = {},
  ): Promise<string> => {
    const end = new Date(`${startDate}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 2);
    const saved = await reservations.insert(
      aDirectReservation({
        status,
        startDate,
        endDate: end.toISOString().slice(0, 10),
        rooms: [aDirectRoom({ stayStatus: STAY_OF[status] })],
        ...changes,
      }),
    );
    return saved.reservationRef;
  };

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

  it('trae las reservas que llegan ese día en ACTIVE, PENDING o IN_PROGRESS, en orden de referencia', async () => {
    const toClose = [
      await stored('ACTIVE'),
      await stored('PENDING'),
      await stored('IN_PROGRESS'),
    ];

    expect(await query.findToClose(DAY, null, 100)).toEqual(
      [...toClose].sort(),
    );
  });

  it('no trae las de ese día en un estado final (COMPLETED, CANCELLED o NO_SHOW)', async () => {
    const active = await stored('ACTIVE');
    for (const status of ['COMPLETED', 'CANCELLED', 'NO_SHOW'] as const) {
      await stored(status);
    }

    expect(await query.findToClose(DAY, null, 100)).toEqual([active]);
  });

  it('no trae las que llegan otro día, aunque sigan ACTIVE o IN_PROGRESS ese día', async () => {
    const active = await stored('ACTIVE');
    await stored('ACTIVE', BEFORE);
    await stored('IN_PROGRESS', BEFORE);
    await stored('ACTIVE', NEXT);

    expect(await query.findToClose(DAY, null, 100)).toEqual([active]);
  });

  it('sin reservas ese día, una lista vacía', async () => {
    await stored('ACTIVE', NEXT);

    expect(await query.findToClose(DAY, null, 100)).toEqual([]);
  });

  it('por lotes: como mucho `limit`, y el siguiente empieza después de la última referencia del anterior', async () => {
    const all: string[] = [];
    for (let index = 0; index < 5; index++) {
      all.push(await stored('ACTIVE'));
    }
    const ordered = [...all].sort();

    const first = await query.findToClose(DAY, null, 2);
    const second = await query.findToClose(DAY, first.at(-1) ?? null, 2);
    const third = await query.findToClose(DAY, second.at(-1) ?? null, 2);
    const fourth = await query.findToClose(DAY, third.at(-1) ?? null, 2);

    expect(first).toEqual(ordered.slice(0, 2));
    expect(second).toEqual(ordered.slice(2, 4));
    expect(third).toEqual(ordered.slice(4));
    expect(fourth).toEqual([]);
  });

  it('una reserva que ya se cerró sale de la selección sin correr el lote siguiente', async () => {
    const all: string[] = [];
    for (let index = 0; index < 4; index++) {
      all.push(await stored('ACTIVE'));
    }
    const ordered = [...all].sort();
    const first = await query.findToClose(DAY, null, 2);
    // El cierre pasa las dos primeras a NO_SHOW.
    await dataSource.query(
      `UPDATE reservation SET status = 'NO_SHOW' WHERE reservation_ref = ANY($1::text[])`,
      [first],
    );

    expect(await query.findToClose(DAY, first.at(-1) ?? null, 2)).toEqual(
      ordered.slice(2),
    );
  });
});
