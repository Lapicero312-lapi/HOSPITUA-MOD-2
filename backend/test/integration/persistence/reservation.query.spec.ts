import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  ReservationStatus,
  StayStatus,
} from '../../../src/domain/shared/enums.js';
import { TypeOrmReservationQuery } from '../../../src/infrastructure/out/persistence/repositories/reservation.query.js';
import { TypeOrmReservationRepository } from '../../../src/infrastructure/out/persistence/repositories/reservation.repository.js';
import { aDirectReservation, aDirectRoom } from '../../support/builders.js';
import { openTestDataSource, truncateAllTables } from '../support/database.js';

/** La estadía que se consulta en las pruebas: llega el 10 y sale el 12 (dos noches). */
const START = '2026-11-10';
const END = '2026-11-12';

describe('TypeOrmReservationQuery.findBlockingRooms contra PostgreSQL real (check-room-availability, A1)', () => {
  let dataSource: DataSource;
  let query: TypeOrmReservationQuery;
  let reservations: TypeOrmReservationRepository;

  /** Guarda una reserva directa con una habitación y devuelve su referencia. */
  async function reserve({
    roomId = randomUUID(),
    startDate = START,
    endDate = END,
    status = 'ACTIVE',
    stayStatus = 'EXPECTED',
  }: {
    roomId?: string;
    startDate?: string;
    endDate?: string;
    status?: ReservationStatus;
    stayStatus?: StayStatus;
  } = {}): Promise<string> {
    const reservation = aDirectReservation({
      startDate,
      endDate,
      status,
      rooms: [aDirectRoom({ roomId, stayStatus })],
    });
    await reservations.insert(reservation);
    return reservation.reservationRef;
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

  it('devuelve la habitación que ya ocupa inventario y la reserva que la ocupa', async () => {
    const roomId = randomUUID();
    const reservationRef = await reserve({ roomId });

    await expect(
      query.findBlockingRooms([roomId], START, END),
    ).resolves.toEqual([{ roomId, reservationRef }]);
  });

  describe('estado de la reserva (FR-002)', () => {
    it.each(['PENDING', 'ACTIVE', 'IN_PROGRESS'] as const)(
      'una reserva en %s bloquea',
      async (status) => {
        const roomId = randomUUID();
        await reserve({ roomId, status });

        await expect(
          query.findBlockingRooms([roomId], START, END),
        ).resolves.toHaveLength(1);
      },
    );

    it.each(['COMPLETED', 'CANCELLED', 'NO_SHOW'] as const)(
      'una reserva en %s no bloquea',
      async (status) => {
        const roomId = randomUUID();
        await reserve({ roomId, status });

        await expect(
          query.findBlockingRooms([roomId], START, END),
        ).resolves.toEqual([]);
      },
    );
  });

  describe('estado de la habitación (FR-002)', () => {
    it.each(['EXPECTED', 'CHECKED_IN'] as const)(
      'una habitación en %s bloquea',
      async (stayStatus) => {
        const roomId = randomUUID();
        await reserve({ roomId, status: 'IN_PROGRESS', stayStatus });

        await expect(
          query.findBlockingRooms([roomId], START, END),
        ).resolves.toHaveLength(1);
      },
    );

    it.each(['CHECKED_OUT', 'NOT_ARRIVED'] as const)(
      'una habitación en %s no bloquea',
      async (stayStatus) => {
        const roomId = randomUUID();
        await reserve({ roomId, status: 'IN_PROGRESS', stayStatus });

        await expect(
          query.findBlockingRooms([roomId], START, END),
        ).resolves.toEqual([]);
      },
    );
  });

  describe('cruce de fechas, con intervalo semiabierto [startDate, endDate)', () => {
    it.each([
      ['las mismas fechas', START, END],
      ['empieza antes y termina dentro', '2026-11-08', '2026-11-11'],
      ['empieza dentro y termina después', '2026-11-11', '2026-11-15'],
      ['contiene toda la estadía', '2026-11-01', '2026-11-30'],
      ['queda dentro de la estadía', '2026-11-10', '2026-11-11'],
    ])('se cruza si %s', async (_caso, startDate, endDate) => {
      const roomId = randomUUID();
      await reserve({ roomId, startDate, endDate });

      await expect(
        query.findBlockingRooms([roomId], START, END),
      ).resolves.toHaveLength(1);
    });

    it.each([
      ['sale el mismo día que llega la consultada', '2026-11-08', START],
      ['llega el mismo día que sale la consultada', END, '2026-11-14'],
      ['es anterior', '2026-11-01', '2026-11-05'],
      ['es posterior', '2026-11-20', '2026-11-22'],
    ])('no se cruza si %s', async (_caso, startDate, endDate) => {
      const roomId = randomUUID();
      await reserve({ roomId, startDate, endDate });

      await expect(
        query.findBlockingRooms([roomId], START, END),
      ).resolves.toEqual([]);
    });
  });

  it('solo busca las habitaciones pedidas', async () => {
    const asked = randomUUID();
    const other = randomUUID();
    const reservationRef = await reserve({ roomId: asked });
    await reserve({ roomId: other });

    await expect(query.findBlockingRooms([asked], START, END)).resolves.toEqual(
      [{ roomId: asked, reservationRef }],
    );
  });

  it('con varias habitaciones devuelve todas las que bloquean, ordenadas por roomId', async () => {
    const [first, second] = [randomUUID(), randomUUID()].sort();
    const free = randomUUID();
    const secondRef = await reserve({ roomId: second });
    const firstRef = await reserve({ roomId: first });

    await expect(
      query.findBlockingRooms([second, free, first], START, END),
    ).resolves.toEqual([
      { roomId: first, reservationRef: firstRef },
      { roomId: second, reservationRef: secondRef },
    ]);
  });

  it('excluye la propia reserva en una modificación (FR-003) y sigue viendo las demás', async () => {
    const roomId = randomUUID();
    const own = await reserve({
      roomId,
      startDate: '2026-11-08',
      endDate: START,
    });
    const other = await reserve({ roomId });

    await expect(
      query.findBlockingRooms([roomId], '2026-11-08', END, own),
    ).resolves.toEqual([{ roomId, reservationRef: other }]);
    await expect(
      query.findBlockingRooms([roomId], '2026-11-08', START, own),
    ).resolves.toEqual([]);
  });

  it('con una lista vacía de habitaciones responde [] sin fallar', async () => {
    await reserve();

    await expect(query.findBlockingRooms([], START, END)).resolves.toEqual([]);
  });
});
