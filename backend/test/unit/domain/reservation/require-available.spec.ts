import { describe, expect, it } from 'vitest';
import {
  FewerAvailableRoomsThanRequestedError,
  requireAvailable,
} from '../../../../src/domain/reservation/require-available.js';
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
      { room: room202, reason: 'RESERVED' },
      { room: room203, reason: 'MAINTENANCE' },
    ]);
  });

  it('con una habitación concreta (por roomId) que no está disponible, lanza el error con su motivo', () => {
    // La 202 del mismo ejemplo, consultada sola.
    const error = thrownBy(() =>
      requireAvailable({ rooms: [aRoomAvailability(room202, 'RESERVED')] }, 1),
    ) as FewerAvailableRoomsThanRequestedError;

    expect(error.unavailableRooms).toEqual([
      { room: room202, reason: 'RESERVED' },
    ]);
  });

  it('una habitación no disponible sin motivo es un error del programa: lanza Error', () => {
    // La 202 del mismo ejemplo, sin su motivo. Se arma a mano: aRoomAvailability no puede armarla,
    // porque es un caso que no debería existir.
    const error = thrownBy(() =>
      requireAvailable(
        { rooms: [{ room: room202, available: false, reason: null }] },
        1,
      ),
    );

    expect(error).not.toBeInstanceOf(FewerAvailableRoomsThanRequestedError);
    expect((error as Error).message).toBe(
      'Habitación inconsistente: una habitación no disponible debe traer su motivo.',
    );
  });
});
