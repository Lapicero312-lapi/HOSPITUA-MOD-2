import { describe, expect, it } from 'vitest';
import {
  type OtaReservationInput,
  type OtaRoomInput,
  Reservation,
} from '../../../../src/domain/reservation/reservation.js';
import { BusinessError } from '../../../../src/domain/shared/business-error.js';
import { aGuest, otaTerms } from '../../../support/builders.js';

const OTA_ID = '6b0c3f2e-1a4d-4e5f-9b8c-7d6e5f4a3b21';
const RECEIVED_AT = new Date('2026-11-05T14:30:00.000Z');

/** Una habitación de `DOBLE` asignada (la 201 o la 202 del ejemplo, capacidad 2), o sin asignar. */
function aRoom(
  roomNumber: string | null,
  changes: Partial<OtaRoomInput> = {},
): OtaRoomInput {
  return {
    categoryRoom: 'DOBLE',
    guestCount: 2,
    assigned:
      roomNumber === null
        ? null
        : {
            roomId: `994d1375-dbbd-4072-8724-b2ab32ce7${roomNumber}`,
            roomNumber,
            maxCapacity: 2,
          },
    ...changes,
  };
}

/** La revisión del ejemplo de A1 del plan: Booking, del 2026-11-10 al 2026-11-12, una habitación. */
function anInput(
  changes: Partial<OtaReservationInput> = {},
): OtaReservationInput {
  return {
    reservationRef: 'RSV-0A1B2C3D',
    startDate: '2026-11-10',
    endDate: '2026-11-12',
    guest: aGuest({ documentType: null, documentNumber: null }),
    notes: 'Llegada tarde',
    ota: otaTerms(OTA_ID, { externalConfirmationCode: '9996013801' }),
    receivedAt: RECEIVED_AT,
    rooms: [aRoom('201')],
    datesDifferPerRoom: false,
    ...changes,
  };
}

describe('Reservation.createOta (T004)', () => {
  it('con todas las habitaciones asignadas: ACTIVE, OTA, con la agencia y sin conflicto', () => {
    const input = anInput();
    const reservation = Reservation.createOta(input);

    expect(reservation).toMatchObject({
      reservationRef: 'RSV-0A1B2C3D',
      source: 'OTA',
      startDate: '2026-11-10',
      endDate: '2026-11-12',
      status: 'ACTIVE',
      statusReason: null,
      notes: 'Llegada tarde',
      conflict: null,
      createdAt: null,
      updatedAt: null,
    });
    expect(reservation.ota).toBe(input.ota);
    expect(reservation.guest).toBe(input.guest);
  });

  it('cada habitación queda en EXPECTED, con la habitación asignada y sin tarifa por habitación', () => {
    const room201 = aRoom('201');
    const room202 = aRoom('202', { guestCount: 1 });
    const reservation = Reservation.createOta(
      anInput({ rooms: [room201, room202] }),
    );

    // El roomId es el que bloquea el inventario en la base (D3): debe ser el de la habitación asignada.
    expect(
      reservation.rooms.map((room) => ({
        roomId: room.roomId,
        roomNumber: room.roomNumber,
        categoryRoom: room.categoryRoom,
        guestCount: room.guestCount,
        stayStatus: room.stayStatus,
        rate: room.rate,
      })),
    ).toEqual([
      {
        roomId: room201.assigned?.roomId,
        roomNumber: '201',
        categoryRoom: 'DOBLE',
        guestCount: 2,
        stayStatus: 'EXPECTED',
        rate: null,
      },
      {
        roomId: room202.assigned?.roomId,
        roomNumber: '202',
        categoryRoom: 'DOBLE',
        guestCount: 1,
        stayStatus: 'EXPECTED',
        rate: null,
      },
    ]);
    expect(reservation.guestCount).toBe(3);
  });

  it('la reserva y cada habitación tienen un id nuevo y distinto', () => {
    const reservation = Reservation.createOta(
      anInput({ rooms: [aRoom('201'), aRoom(null)] }),
    );
    const ids = [reservation.id, ...reservation.rooms.map((room) => room.id)];

    expect(new Set(ids).size).toBe(3);
  });

  it('dos reservas creadas con los mismos datos tienen ids distintos', () => {
    const first = Reservation.createOta(anInput());
    const second = Reservation.createOta(anInput());

    expect(second.id).not.toBe(first.id);
    expect(second.rooms[0]?.id).not.toBe(first.rooms[0]?.id);
  });

  describe('nunca rechaza: marca el conflicto (D13)', () => {
    it('una habitación sin lugar queda sin asignar, sin bloquear inventario, y da NO_ROOM_AVAILABLE con la hora de la revisión', () => {
      const reservation = Reservation.createOta(
        anInput({ rooms: [aRoom('201'), aRoom(null)] }),
      );
      const [assigned, unassigned] = reservation.rooms;

      expect(reservation.conflict).toEqual({
        reason: 'NO_ROOM_AVAILABLE',
        detectedAt: RECEIVED_AT,
      });
      expect(unassigned).toMatchObject({ roomId: null, roomNumber: null });
      expect(unassigned?.blocksInventory('ACTIVE')).toBe(false);
      expect(assigned?.blocksInventory('ACTIVE')).toBe(true);
    });

    it('dos habitaciones sin asignar caben en la misma reserva', () => {
      const reservation = Reservation.createOta(
        anInput({ rooms: [aRoom(null), aRoom(null)] }),
      );

      expect(reservation.rooms).toHaveLength(2);
      expect(reservation.conflict?.reason).toBe('NO_ROOM_AVAILABLE');
    });

    it('una habitación asignada con más personas que su capacidad se crea igual y da CAPACITY_EXCEEDED', () => {
      const reservation = Reservation.createOta(
        anInput({ rooms: [aRoom('201', { guestCount: 5 })] }),
      );

      expect(reservation.conflict).toEqual({
        reason: 'CAPACITY_EXCEEDED',
        detectedAt: RECEIVED_AT,
      });
      expect(reservation.rooms[0]?.guestCount).toBe(5);
    });

    it('justo en la capacidad no hay conflicto', () => {
      expect(
        Reservation.createOta(
          anInput({ rooms: [aRoom('201', { guestCount: 2 })] }),
        ).conflict,
      ).toBeNull();
    });

    it('fechas distintas por habitación dan CHANGE_NOT_APPLICABLE', () => {
      expect(
        Reservation.createOta(anInput({ datesDifferPerRoom: true })).conflict,
      ).toEqual({ reason: 'CHANGE_NOT_APPLICABLE', detectedAt: RECEIVED_AT });
    });

    it.each<[string, Partial<OtaReservationInput>, string]>([
      [
        'sin lugar y sobre la capacidad: gana NO_ROOM_AVAILABLE',
        { rooms: [aRoom('201', { guestCount: 5 }), aRoom(null)] },
        'NO_ROOM_AVAILABLE',
      ],
      [
        'sin lugar y con fechas distintas: gana NO_ROOM_AVAILABLE',
        { rooms: [aRoom(null)], datesDifferPerRoom: true },
        'NO_ROOM_AVAILABLE',
      ],
      [
        'sobre la capacidad y con fechas distintas: gana CAPACITY_EXCEEDED',
        { rooms: [aRoom('201', { guestCount: 5 })], datesDifferPerRoom: true },
        'CAPACITY_EXCEEDED',
      ],
    ])(
      'con varios motivos, el primero del paso 8 de B1: %s',
      (_caso, changes, reason) => {
        expect(Reservation.createOta(anInput(changes)).conflict?.reason).toBe(
          reason,
        );
      },
    );
  });

  describe('las invariantes de Reservation', () => {
    it.each<[string, Partial<OtaReservationInput>, string]>([
      ['sin habitaciones', { rooms: [] }, 'INVALID_ROOM_COUNT'],
      [
        'con 11 habitaciones (el mapeador no las deja pasar)',
        { rooms: Array.from({ length: 11 }, () => aRoom(null)) },
        'INVALID_ROOM_COUNT',
      ],
      [
        'con la salida el mismo día de la entrada',
        { endDate: '2026-11-10' },
        'INVALID_RESERVATION_DATES',
      ],
      [
        'con notes de más de 500 caracteres',
        { notes: 'a'.repeat(501) },
        'NOTES_TOO_LONG',
      ],
    ])('%s da %s', (_caso, changes, errorCode) => {
      expect(() => Reservation.createOta(anInput(changes))).toThrow(
        expect.objectContaining({ errorCode }) as BusinessError,
      );
    });
  });
});
