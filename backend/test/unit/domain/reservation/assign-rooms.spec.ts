import { describe, expect, it } from 'vitest';
import { assignRooms } from '../../../../src/domain/reservation/assign-rooms.js';
import {
  aRoomAvailability,
  theAvailabilityExample,
} from '../../../support/room-availability.js';

/** El ejemplo del plan: la 201 disponible, la 202 reservada y la 203 en mantenimiento. */
const { room201, room202, room203, result } = theAvailabilityExample();

/** Las tres habitaciones del mismo ejemplo, disponibles y desordenadas. */
const ALL_AVAILABLE = {
  rooms: [room203, room201, room202].map((room) => aRoomAvailability(room)),
};

describe('assignRooms', () => {
  it('elige las disponibles de menor roomNumber, aunque lleguen desordenadas', () => {
    expect(assignRooms(ALL_AVAILABLE, 2, [])).toEqual([room201, room202]);
  });

  it('solo elige habitaciones disponibles: si hay menos que las pedidas, devuelve las que haya', () => {
    expect(assignRooms(result, 2, [])).toEqual([room201]);
  });

  it('no repite una habitación ya asignada a la misma reserva', () => {
    expect(assignRooms(ALL_AVAILABLE, 1, [room201.id])).toEqual([room202]);
  });
});
