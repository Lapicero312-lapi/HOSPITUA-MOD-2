import { describe, expect, it } from 'vitest';
import {
  type DirectReservationInput,
  type DirectRoomInput,
  Reservation,
} from '../../../../src/domain/reservation/reservation.js';
import { BusinessError } from '../../../../src/domain/shared/business-error.js';
import { Money } from '../../../../src/domain/shared/money.js';
import { aGuest } from '../../../support/builders.js';

/** Las habitaciones y las tarifas del ejemplo de B del plan: la 201 y la 202 de `DOBLE`, capacidad 2. */
function aRoom(
  roomNumber: string,
  changes: Partial<DirectRoomInput> = {},
): DirectRoomInput {
  return {
    room: {
      roomId: `3f6c1e2a-8b4d-4c7e-9a1f-2b3c4d5e6${roomNumber}`,
      roomNumber,
      categoryRoom: 'DOBLE',
      maxCapacity: 2,
    },
    guestCount: 2,
    rate: {
      roomGrossAmount: Money.of('750000.00', 'COP'),
      quoteId: `Q-${roomNumber}`,
    },
    ...changes,
  };
}

function anInput(
  changes: Partial<DirectReservationInput> = {},
): DirectReservationInput {
  return {
    reservationRef: 'RSV-3F9A1C7B',
    startDate: '2026-10-12',
    endDate: '2026-10-15',
    guest: aGuest(),
    notes: 'Llegada después de las 8 p. m.',
    rooms: [aRoom('201'), aRoom('202')],
    ...changes,
  };
}

/** El código del `BusinessError` que lanza la fábrica. */
function errorCodeOf(input: DirectReservationInput): string {
  try {
    Reservation.createDirect(input);
  } catch (error) {
    if (error instanceof BusinessError) {
      return error.errorCode;
    }
    throw error;
  }
  throw new Error('Se esperaba un BusinessError');
}

describe('Reservation.createDirect (T002)', () => {
  it('crea la reserva del ejemplo de B: ACTIVE, DIRECT, sin agencia ni conflicto y con comisión 0', () => {
    const guest = aGuest();
    const reservation = Reservation.createDirect(anInput({ guest }));

    expect(reservation).toMatchObject({
      reservationRef: 'RSV-3F9A1C7B',
      source: 'DIRECT',
      startDate: '2026-10-12',
      endDate: '2026-10-15',
      status: 'ACTIVE',
      statusReason: null,
      notes: 'Llegada después de las 8 p. m.',
      ota: null,
      conflict: null,
      commissionPercentage: '0',
      createdAt: null,
      updatedAt: null,
      guestCount: 4,
    });
    expect(reservation.guest).toBe(guest);
  });

  it('cada habitación queda asignada, en EXPECTED y con su tarifa', () => {
    const reservation = Reservation.createDirect(anInput());

    expect(
      reservation.rooms.map((room) => ({
        roomId: room.roomId,
        roomNumber: room.roomNumber,
        categoryRoom: room.categoryRoom,
        guestCount: room.guestCount,
        stayStatus: room.stayStatus,
        quoteId: room.rate?.quoteId,
        amount: room.rate?.roomGrossAmount.amount,
      })),
    ).toEqual([
      {
        roomId: aRoom('201').room.roomId,
        roomNumber: '201',
        categoryRoom: 'DOBLE',
        guestCount: 2,
        stayStatus: 'EXPECTED',
        quoteId: 'Q-201',
        amount: '750000',
      },
      {
        roomId: aRoom('202').room.roomId,
        roomNumber: '202',
        categoryRoom: 'DOBLE',
        guestCount: 2,
        stayStatus: 'EXPECTED',
        quoteId: 'Q-202',
        amount: '750000',
      },
    ]);
  });

  it('la reserva y cada habitación tienen un id nuevo y distinto', () => {
    const first = Reservation.createDirect(anInput());
    const second = Reservation.createDirect(anInput());
    const ids = [
      first.id,
      second.id,
      ...first.rooms.map((room) => room.id),
      ...second.rooms.map((room) => room.id),
    ];

    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    }
  });

  it('sin notes, las deja vacías', () => {
    expect(Reservation.createDirect(anInput({ notes: null })).notes).toBeNull();
  });

  describe('capacidad (GUEST_COUNT_EXCEEDS_CAPACITY)', () => {
    it('una habitación con más personas que su capacidad da el código y el mensaje literal del plan', () => {
      expect(() =>
        Reservation.createDirect(
          anInput({ rooms: [aRoom('201'), aRoom('202', { guestCount: 3 })] }),
        ),
      ).toThrow(
        new BusinessError(
          'GUEST_COUNT_EXCEEDS_CAPACITY',
          'La cantidad de personas supera la capacidad de la habitación.',
        ),
      );
    });

    it('justo en la capacidad sí se crea', () => {
      expect(() =>
        Reservation.createDirect(
          anInput({
            rooms: [aRoom('201', { guestCount: 2 })],
          }),
        ),
      ).not.toThrow();
    });
  });

  describe('las invariantes de Reservation', () => {
    it.each<[string, Partial<DirectReservationInput>, string]>([
      ['sin habitaciones', { rooms: [] }, 'INVALID_ROOM_COUNT'],
      [
        'con 11 habitaciones',
        {
          rooms: Array.from({ length: 11 }, (_, index) =>
            aRoom(String(100 + index)),
          ),
        },
        'INVALID_ROOM_COUNT',
      ],
      [
        'con la misma habitación dos veces',
        { rooms: [aRoom('201'), aRoom('201')] },
        'ROOM_ALREADY_IN_RESERVATION',
      ],
      [
        'con una habitación sin personas',
        { rooms: [aRoom('201', { guestCount: 0 })] },
        'GUEST_COUNT_TOO_LOW',
      ],
      [
        'con la salida el mismo día de la entrada',
        { endDate: '2026-10-12' },
        'INVALID_RESERVATION_DATES',
      ],
      [
        'con notes de más de 500 caracteres',
        { notes: 'a'.repeat(501) },
        'NOTES_TOO_LONG',
      ],
    ])('%s da %s', (_caso, changes, errorCode) => {
      expect(errorCodeOf(anInput(changes))).toBe(errorCode);
    });

    it('con 11 habitaciones y una sobre la capacidad, gana la cantidad de habitaciones', () => {
      const rooms = Array.from({ length: 11 }, (_, index) =>
        aRoom(String(100 + index), { guestCount: index === 0 ? 3 : 2 }),
      );

      expect(errorCodeOf(anInput({ rooms }))).toBe('INVALID_ROOM_COUNT');
    });

    it('con la misma habitación repetida y una sobre la capacidad, gana la habitación repetida', () => {
      expect(
        errorCodeOf(
          anInput({ rooms: [aRoom('201'), aRoom('201', { guestCount: 3 })] }),
        ),
      ).toBe('ROOM_ALREADY_IN_RESERVATION');
    });
  });

  it('habitaciones de categorías distintas son un error del programa, no un BusinessError', () => {
    const suite = aRoom('202', {
      room: { ...aRoom('202').room, categoryRoom: 'SUITE_JUNIOR' },
    });

    const error: unknown = (() => {
      try {
        Reservation.createDirect(anInput({ rooms: [aRoom('201'), suite] }));
      } catch (caught) {
        return caught;
      }
      return undefined;
    })();

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(BusinessError);
  });
});
