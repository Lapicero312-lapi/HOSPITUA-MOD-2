import { describe, expect, it } from 'vitest';
import { assignRooms } from '../../../../src/domain/reservation/assign-rooms.js';
import {
  aRoom,
  aRoomAvailability,
} from '../../../support/room-availability.js';

/** Habitaciones del ejemplo del plan (DTO `availability`, categoría DOBLE). */
const room201 = aRoom({ roomNumber: '201' });
const room202 = aRoom({ roomNumber: '202' });
const room203 = aRoom({ roomNumber: '203' });

/**
 * El resultado del ejemplo del plan, del 2026-10-10 al 2026-10-12: la 201 disponible, la 202 reservada
 * y la 203 en mantenimiento.
 */
const RESULT = {
  startDate: '2026-10-10',
  endDate: '2026-10-12',
  rooms: [
    aRoomAvailability(room201),
    aRoomAvailability(room202, 'RESERVED'),
    aRoomAvailability(room203, 'MAINTENANCE'),
  ],
};

/** Las tres habitaciones del mismo ejemplo, disponibles y desordenadas. */
const ALL_AVAILABLE = {
  rooms: [room203, room201, room202].map((room) => aRoomAvailability(room)),
};

describe('assignRooms', () => {
  it('elige las disponibles de menor roomNumber, aunque lleguen desordenadas', () => {
    expect(assignRooms(ALL_AVAILABLE, 2, [])).toEqual([room201, room202]);
  });

  it('solo elige habitaciones disponibles: si hay menos que las pedidas, devuelve las que haya', () => {
    expect(assignRooms(RESULT, 2, [])).toEqual([room201]);
  });

  it('no repite una habitación ya asignada a la misma reserva', () => {
    expect(assignRooms(ALL_AVAILABLE, 1, [room201.id])).toEqual([room202]);
  });
});
