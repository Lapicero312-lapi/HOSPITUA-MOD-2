import { describe, expect, it } from 'vitest';
import {
  FewerAvailableRoomsThanRequestedError,
  requireAvailable,
} from '../../../../src/domain/reservation/require-available.js';

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

/** Lo que lanza `action`, para revisar el error. */
function thrownBy(action: () => void): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  throw new Error('No lanzó ningún error.');
}

describe('requireAvailable', () => {
  it('no lanza nada si hay tantas habitaciones disponibles como las pedidas', () => {
    expect(() => requireAvailable(RESULT, 1)).not.toThrow();
  });

  it('si hay menos disponibles que las pedidas, lanza FewerAvailableRoomsThanRequestedError', () => {
    const error = thrownBy(() => requireAvailable(RESULT, 2));

    expect(error).toBeInstanceOf(FewerAvailableRoomsThanRequestedError);
    expect((error as Error).message).toBe(
      'Hay menos habitaciones disponibles que las pedidas.',
    );
  });

  it('el error lleva las habitaciones que no están disponibles y su motivo', () => {
    const error = thrownBy(() =>
      requireAvailable(RESULT, 2),
    ) as FewerAvailableRoomsThanRequestedError;

    expect(error.unavailableRooms).toEqual([
      { room: ROOM_202, reason: 'RESERVED' },
      { room: ROOM_203, reason: 'MAINTENANCE' },
    ]);
  });

  it('con una habitación concreta (por roomId) que no está disponible, lanza el error con su motivo', () => {
    // La 202 del mismo ejemplo, consultada sola.
    const error = thrownBy(() =>
      requireAvailable({ rooms: [RESULT.rooms[1]] }, 1),
    ) as FewerAvailableRoomsThanRequestedError;

    expect(error.unavailableRooms).toEqual([
      { room: ROOM_202, reason: 'RESERVED' },
    ]);
  });
});
