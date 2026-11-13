import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ReservationProps } from '../../../src/domain/reservation/reservation.js';
import {
  RESERVATION_STATUSES,
  type ReservationStatus,
} from '../../../src/domain/shared/enums.js';
import { TypeOrmOtaRepository } from '../../../src/infrastructure/out/persistence/repositories/ota.repository.js';
import { TypeOrmReservationQuery } from '../../../src/infrastructure/out/persistence/repositories/reservation-query.repository.js';
import { TypeOrmReservationRepository } from '../../../src/infrastructure/out/persistence/repositories/reservation.repository.js';
import {
  aDirectReservation,
  aDirectRoom,
  anOta,
  anOtaReservation,
  anOtaRoom,
} from '../../support/builders.js';
import { openTestDataSource, truncateAllTables } from '../support/database.js';

/** El rango de la consulta: del 2026-10-20 al 2026-10-25, los dos incluidos. */
const FROM = '2026-10-20';
const TO = '2026-10-25';

const VIGENTES: readonly ReservationStatus[] = [
  'PENDING',
  'ACTIVE',
  'IN_PROGRESS',
];

describe('TypeOrmReservationQuery.findByStayRange contra PostgreSQL real (check-view-reservation, C5, T033)', () => {
  let dataSource: DataSource;
  let query: TypeOrmReservationQuery;
  let reservations: TypeOrmReservationRepository;

  /** Una reserva directa dentro del rango salvo que `changes` diga otra cosa. */
  const reservation = (changes: Partial<ReservationProps> = {}) =>
    reservations.insert(
      aDirectReservation({
        startDate: '2026-10-21',
        endDate: '2026-10-23',
        ...changes,
      }),
    );

  const find = (roomId: string | null = null) =>
    query.findByStayRange(FROM, TO, roomId);

  const refs = async (roomId: string | null = null) =>
    (await find(roomId)).map(({ reservationRef }) => reservationRef);

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

  it('sin reservas devuelve una lista vacía', async () => {
    await expect(find()).resolves.toEqual([]);
  });

  it('devuelve la reserva del ejemplo de C5 con sus campos y nada más', async () => {
    const roomId = randomUUID();
    const stored = await reservation({
      startDate: '2026-10-23',
      endDate: '2026-10-25',
      rooms: [
        aDirectRoom({ roomId, roomNumber: '204', categoryRoom: 'DOBLE' }),
      ],
    });

    await expect(find()).resolves.toEqual([
      {
        reservationRef: stored.reservationRef,
        status: 'ACTIVE',
        startDate: '2026-10-23',
        endDate: '2026-10-25',
        rooms: [{ roomId, roomNumber: '204', categoryRoom: 'DOBLE' }],
      },
    ]);
  });

  describe('solo las reservas vigentes', () => {
    it.each(VIGENTES)('incluye una reserva %s', async (status) => {
      const stored = await reservation({ status });

      await expect(refs()).resolves.toEqual([stored.reservationRef]);
    });

    it.each(
      RESERVATION_STATUSES.filter((status) => !VIGENTES.includes(status)),
    )('excluye una reserva %s', async (status) => {
      await reservation({ status });

      await expect(refs()).resolves.toEqual([]);
    });
  });

  describe('el cruce con el rango: start_date <= dateTo y end_date > dateFrom', () => {
    it.each([
      ['llega antes y sale dentro del rango', '2026-10-18', '2026-10-21'],
      ['llega el último día del rango', TO, '2026-10-27'],
      [
        'llega antes y sale después: cubre todo el rango',
        '2026-10-15',
        '2026-10-30',
      ],
      ['sale un día después del primero', '2026-10-19', '2026-10-21'],
    ])('incluye la que %s', async (_, startDate, endDate) => {
      const stored = await reservation({ startDate, endDate });

      await expect(refs()).resolves.toEqual([stored.reservationRef]);
    });

    it.each([
      ['sale el primer día del rango: ese día ya no ocupa', '2026-10-18', FROM],
      ['llega el día siguiente al último', '2026-10-26', '2026-10-28'],
      ['terminó mucho antes', '2026-09-01', '2026-09-03'],
    ])('excluye la que %s', async (_, startDate, endDate) => {
      await reservation({ startDate, endDate });

      await expect(refs()).resolves.toEqual([]);
    });
  });

  describe('con roomId', () => {
    it('devuelve solo las reservas que tienen esa habitación, cada una con todas sus habitaciones', async () => {
      const roomId = randomUUID();
      const otherRoomId = randomUUID();
      const withRoom = await reservation({
        rooms: [
          aDirectRoom({ roomId, roomNumber: '204' }),
          aDirectRoom({ roomId: otherRoomId, roomNumber: '205' }),
        ],
      });
      await reservation({ rooms: [aDirectRoom({ roomNumber: '301' })] });

      await expect(find(roomId)).resolves.toEqual([
        {
          reservationRef: withRoom.reservationRef,
          status: 'ACTIVE',
          startDate: '2026-10-21',
          endDate: '2026-10-23',
          rooms: [
            { roomId, roomNumber: '204', categoryRoom: 'DOBLE' },
            { roomId: otherRoomId, roomNumber: '205', categoryRoom: 'DOBLE' },
          ],
        },
      ]);
    });

    it('cuenta la habitación en cualquier stayStatus: una que ya salió sigue trayendo la reserva', async () => {
      const roomId = randomUUID();
      const stored = await reservation({
        status: 'IN_PROGRESS',
        rooms: [
          aDirectRoom({ roomId, roomNumber: '204', stayStatus: 'CHECKED_OUT' }),
          aDirectRoom({ roomNumber: '205', stayStatus: 'CHECKED_IN' }),
        ],
      });

      await expect(refs(roomId)).resolves.toEqual([stored.reservationRef]);
    });

    it('si esa habitación solo está en una reserva fuera del rango o que no está vigente, no devuelve nada', async () => {
      const roomId = randomUUID();
      await reservation({
        startDate: '2026-11-10',
        endDate: '2026-11-12',
        rooms: [aDirectRoom({ roomId })],
      });
      await reservation({
        status: 'CANCELLED',
        rooms: [aDirectRoom({ roomId })],
      });

      await expect(refs(roomId)).resolves.toEqual([]);
    });

    it('con una habitación que ninguna reserva tiene devuelve una lista vacía', async () => {
      await reservation();

      await expect(find(randomUUID())).resolves.toEqual([]);
    });
  });

  it('ordena por startDate y después por reservationRef, ascendentes', async () => {
    const late = await reservation({
      reservationRef: 'RSV-0000000A',
      startDate: '2026-10-24',
      endDate: '2026-10-26',
    });
    const earlyB = await reservation({
      reservationRef: 'RSV-0000000C',
      startDate: '2026-10-20',
      endDate: '2026-10-22',
    });
    const earlyA = await reservation({
      reservationRef: 'RSV-0000000B',
      startDate: '2026-10-20',
      endDate: '2026-10-22',
    });

    await expect(refs()).resolves.toEqual([
      earlyA.reservationRef,
      earlyB.reservationRef,
      late.reservationRef,
    ]);
  });

  it('las habitaciones de cada reserva salen por roomNumber', async () => {
    await reservation({
      rooms: [
        aDirectRoom({ roomNumber: '305' }),
        aDirectRoom({ roomNumber: '204' }),
        aDirectRoom({ roomNumber: '210' }),
      ],
    });

    const [found] = await find();

    expect(found.rooms.map(({ roomNumber }) => roomNumber)).toEqual([
      '204',
      '210',
      '305',
    ]);
  });

  it('una habitación sin asignar (reserva de Booking en conflicto) sale con roomId y roomNumber en null', async () => {
    const ota = await new TypeOrmOtaRepository(dataSource).insert(anOta());
    const stored = await reservations.insert(
      anOtaReservation(ota.id, {
        startDate: '2026-10-21',
        endDate: '2026-10-23',
        rooms: [
          anOtaRoom({ roomId: null, roomNumber: null, categoryRoom: 'SUITE' }),
        ],
        conflict: {
          reason: 'NO_ROOM_AVAILABLE',
          detectedAt: new Date('2026-10-08T14:00:00.000Z'),
        },
      }),
    );

    await expect(find()).resolves.toEqual([
      {
        reservationRef: stored.reservationRef,
        status: 'ACTIVE',
        startDate: '2026-10-21',
        endDate: '2026-10-23',
        rooms: [{ roomId: null, roomNumber: null, categoryRoom: 'SUITE' }],
      },
    ]);
  });
});
