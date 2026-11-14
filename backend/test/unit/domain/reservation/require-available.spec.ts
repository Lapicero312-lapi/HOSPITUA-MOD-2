import { describe, expect, it } from 'vitest';
import {
  FewerAvailableRoomsThanRequestedError,
  requireAvailable,
} from '../../../../src/domain/reservation/require-available.js';
import {
  aRoomAvailability,
  theAvailabilityExample,
} from '../../../support/room-availability.js';

/** El ejemplo del plan: la 201 disponible, la 202 reservada y la 203 en mantenimiento. */
const { room202, room203, result } = theAvailabilityExample();

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
    expect(() => requireAvailable(result, 1)).not.toThrow();
  });

  it('si hay menos disponibles que las pedidas, lanza FewerAvailableRoomsThanRequestedError', () => {
    const error = thrownBy(() => requireAvailable(result, 2));

    expect(error).toBeInstanceOf(FewerAvailableRoomsThanRequestedError);
    expect((error as Error).message).toBe(
      'Hay menos habitaciones disponibles que las pedidas.',
    );
  });

  it('el error lleva las habitaciones que no están disponibles y su motivo', () => {
    const error = thrownBy(() =>
      requireAvailable(result, 2),
    ) as FewerAvailableRoomsThanRequestedError;

    expect(error.unavailableRooms).toEqual([
      { room: room202, reason: 'RESERVED' },
      { room: room203, reason: 'MAINTENANCE' },
    ]);
  });

  it('con una habitación concreta (por roomId) que no está disponible, lanza el error con su motivo', () => {
    // La 202 del mismo ejemplo, consultada sola.
    const error = thrownBy(() =>
      requireAvailable(
        {
          rooms: [
            aRoomAvailability(room202, {
              available: false,
              reason: 'RESERVED',
            }),
          ],
        },
        1,
      ),
    ) as FewerAvailableRoomsThanRequestedError;

    expect(error.unavailableRooms).toEqual([
      { room: room202, reason: 'RESERVED' },
    ]);
  });

  it('una habitación no disponible sin motivo es un error del programa: lanza Error', () => {
    // La 202 del mismo ejemplo, no disponible y sin su motivo.
    const error = thrownBy(() =>
      requireAvailable(
        { rooms: [aRoomAvailability(room202, { available: false })] },
        1,
      ),
    );

    expect(error).not.toBeInstanceOf(FewerAvailableRoomsThanRequestedError);
    expect((error as Error).message).toBe(
      'Habitación inconsistente: una habitación no disponible debe traer su motivo.',
    );
  });
});
