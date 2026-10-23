import { describe, expect, it } from 'vitest';
import { assignRooms } from '../../../../src/domain/reservation/assign-rooms.js';

/**
 * Habitaciones del ejemplo del plan (DTO `availability`, categoría DOBLE). Los planes no traen su `id`:
 * son UUID de otros campos de los planes (el `room_type_id` de Channex, un `quoteId` y un `otaId`).
 */
const ROOM_201 = {
  id: '994d1375-dbbd-4072-8724-b2ab32ce781b',
  roomNumber: '201',
  categoryRoom: 'DOBLE',
};
const ROOM_202 = {
  id: '8b1f6c0e-7d1a-4c0b-9d5e-2f4f3b6a1c11',
  roomNumber: '202',
  categoryRoom: 'DOBLE',
};
const ROOM_203 = {
  id: '5b0e7c1a-2f4d-4e8b-9c3a-1d6f8e2b7a90',
  roomNumber: '203',
  categoryRoom: 'DOBLE',
};

/**
 * El resultado del ejemplo del plan, del 2026-10-10 al 2026-10-12: la 201 disponible, la 202 reservada
 * y la 203 en mantenimiento.
 */
const RESULT = {
  startDate: '2026-10-10',
  endDate: '2026-10-12',
  rooms: [
    { room: ROOM_201, available: true, reason: null },
    { room: ROOM_202, available: false, reason: 'RESERVED' },
    {
      room: ROOM_203,
      available: false,
      reason: 'MAINTENANCE',
      maintenance: [{ overlapStart: '2026-10-11', overlapEnd: '2026-10-12' }],
    },
  ],
} as const;

/** Las tres habitaciones del mismo ejemplo, disponibles y desordenadas. */
const ALL_AVAILABLE = {
  rooms: [
    { room: ROOM_203, available: true },
    { room: ROOM_201, available: true },
    { room: ROOM_202, available: true },
  ],
};

describe('assignRooms', () => {
  it('elige las disponibles de menor roomNumber, aunque lleguen desordenadas', () => {
    expect(assignRooms(ALL_AVAILABLE, 2, [])).toEqual([ROOM_201, ROOM_202]);
  });

  it('solo elige habitaciones disponibles: si hay menos que las pedidas, devuelve las que haya', () => {
    expect(assignRooms(RESULT, 2, [])).toEqual([ROOM_201]);
  });

  it('no repite una habitación ya asignada a la misma reserva', () => {
    expect(assignRooms(ALL_AVAILABLE, 1, [ROOM_201.id])).toEqual([ROOM_202]);
  });
});
