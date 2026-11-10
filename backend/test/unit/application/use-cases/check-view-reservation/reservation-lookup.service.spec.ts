import { describe, expect, it, vi } from 'vitest';
import type {
  BlockingRoom,
  NightBlockingRooms,
  ReservationQueryPort,
} from '../../../../../src/application/ports/out/reservation-query.port.js';
import type { ReservationRepository } from '../../../../../src/application/ports/out/reservation.repository.js';
import type { Transaction } from '../../../../../src/application/ports/out/transaction.js';
import { aDirectReservation } from '../../../../support/builders.js';
import { ReservationLookupService } from '../../../../../src/application/use-cases/check-view-reservation/reservation-lookup.service.js';

const ROOM_201 = '3f6c1e2a-8b4d-4c7e-9a1f-2b3c4d5e6f70';

function lookupAnswering(blocking: BlockingRoom[]) {
  const findBlockingRooms = vi.fn(() => Promise.resolve(blocking));
  // findBlockingRooms solo usa la consulta; findByRef, el repositorio.
  const query = { findBlockingRooms } as unknown as ReservationQueryPort;
  const reservations = {} as ReservationRepository;
  return {
    lookup: new ReservationLookupService(query, reservations),
    findBlockingRooms,
  };
}

describe('ReservationLookup.findBlockingRooms', () => {
  it('pide a ReservationQueryPort las habitaciones, el rango y la reserva a excluir, y devuelve lo que responde', async () => {
    const blocking = [{ roomId: ROOM_201, reservationRef: 'RSV-0A1B2C3D' }];
    const { lookup, findBlockingRooms } = lookupAnswering(blocking);

    await expect(
      lookup.findBlockingRooms(
        [ROOM_201],
        '2026-11-10',
        '2026-11-12',
        'RSV-9F8E7D6C',
      ),
    ).resolves.toEqual(blocking);
    expect(findBlockingRooms).toHaveBeenCalledWith(
      [ROOM_201],
      '2026-11-10',
      '2026-11-12',
      'RSV-9F8E7D6C',
    );
  });

  it('sin reserva a excluir, la pide sin ella', async () => {
    const { lookup, findBlockingRooms } = lookupAnswering([]);

    await lookup.findBlockingRooms([ROOM_201], '2026-11-10', '2026-11-12');

    expect(findBlockingRooms).toHaveBeenCalledWith(
      [ROOM_201],
      '2026-11-10',
      '2026-11-12',
      undefined,
    );
  });

  it('sin habitaciones devuelve [] sin consultar la base', async () => {
    const { lookup, findBlockingRooms } = lookupAnswering([
      { roomId: ROOM_201, reservationRef: 'RSV-0A1B2C3D' },
    ]);

    await expect(
      lookup.findBlockingRooms([], '2026-11-10', '2026-11-12'),
    ).resolves.toEqual([]);
    expect(findBlockingRooms).not.toHaveBeenCalled();
  });
});

describe('ReservationLookup.findByRef (T008 de check-room-availability)', () => {
  it('pide la reserva a ReservationRepository y devuelve lo que responde, también null', async () => {
    const reservation = aDirectReservation();
    const findByRef = vi.fn((reservationRef: string) =>
      Promise.resolve(
        reservationRef === reservation.reservationRef ? reservation : null,
      ),
    );
    const lookup = new ReservationLookupService(
      {} as ReservationQueryPort,
      { findByRef } as unknown as ReservationRepository,
    );

    await expect(lookup.findByRef(reservation.reservationRef)).resolves.toBe(
      reservation,
    );
    await expect(lookup.findByRef('RSV-00000000')).resolves.toBeNull();
    expect(findByRef).toHaveBeenCalledWith(reservation.reservationRef);
  });
});

describe('ReservationLookup.findForUpdate (T005 de cancel-reservation)', () => {
  it('pide a ReservationRepository la reserva bloqueada en la transacción de quien llama, y devuelve lo que responde, también null', async () => {
    const reservation = aDirectReservation();
    const tx = { tx: 'la de la cancelación' } as unknown as Transaction;
    const lockByRef = vi.fn((reservationRef: string) =>
      Promise.resolve(
        reservationRef === reservation.reservationRef ? reservation : null,
      ),
    );
    const lookup = new ReservationLookupService(
      {} as ReservationQueryPort,
      { lockByRef } as unknown as ReservationRepository,
    );

    await expect(
      lookup.findForUpdate(tx, reservation.reservationRef),
    ).resolves.toBe(reservation);
    await expect(lookup.findForUpdate(tx, 'RSV-00000000')).resolves.toBeNull();
    expect(lockByRef).toHaveBeenCalledWith(reservation.reservationRef, tx);
  });
});

describe('ReservationLookup.blockingRoomsByCategory (T016c)', () => {
  function lookupByCategory(nights: NightBlockingRooms[]) {
    const blockingRoomsByCategory = vi.fn(() => Promise.resolve(nights));
    const query = {
      blockingRoomsByCategory,
    } as unknown as ReservationQueryPort;
    return {
      lookup: new ReservationLookupService(query, {} as ReservationRepository),
      blockingRoomsByCategory,
    };
  }

  it('pide a ReservationQueryPort la categoría y el rango, y devuelve lo que responde', async () => {
    const nights = [
      { date: '2026-11-10', roomIds: [ROOM_201] },
      { date: '2026-11-11', roomIds: [] },
    ];
    const { lookup, blockingRoomsByCategory } = lookupByCategory(nights);

    await expect(
      lookup.blockingRoomsByCategory('DOBLE', '2026-11-10', '2026-11-12'),
    ).resolves.toEqual(nights);
    expect(blockingRoomsByCategory).toHaveBeenCalledExactlyOnceWith(
      'DOBLE',
      '2026-11-10',
      '2026-11-12',
    );
  });

  it('con una sola noche (dateTo el día siguiente) consulta la base', async () => {
    const { lookup, blockingRoomsByCategory } = lookupByCategory([]);

    await lookup.blockingRoomsByCategory('DOBLE', '2026-11-10', '2026-11-11');

    expect(blockingRoomsByCategory).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['dateFrom igual a dateTo', '2026-11-10', '2026-11-10'],
    ['dateFrom después de dateTo', '2026-11-12', '2026-11-10'],
  ])(
    'con %s devuelve [] sin consultar la base',
    async (_, dateFrom, dateTo) => {
      const { lookup, blockingRoomsByCategory } = lookupByCategory([
        { date: '2026-11-10', roomIds: [ROOM_201] },
      ]);

      await expect(
        lookup.blockingRoomsByCategory('DOBLE', dateFrom, dateTo),
      ).resolves.toEqual([]);
      expect(blockingRoomsByCategory).not.toHaveBeenCalled();
    },
  );
});
