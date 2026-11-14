import { describe, expect, it } from 'vitest';
import type {
  ReservationStatus,
  StayStatus,
} from '../../../../src/domain/shared/enums.js';
import { aDirectRoom, anOtaRoom } from '../../../support/builders.js';

describe('ReservationRoom', () => {
  describe('blocksInventory (D3)', () => {
    it.each<[ReservationStatus, StayStatus, boolean]>([
      ['PENDING', 'EXPECTED', true],
      ['ACTIVE', 'EXPECTED', true],
      ['IN_PROGRESS', 'CHECKED_IN', true],
      ['IN_PROGRESS', 'EXPECTED', true],
      ['IN_PROGRESS', 'CHECKED_OUT', false],
      ['IN_PROGRESS', 'NOT_ARRIVED', false],
      ['COMPLETED', 'CHECKED_OUT', false],
      ['CANCELLED', 'EXPECTED', false],
      ['NO_SHOW', 'NOT_ARRIVED', false],
    ])(
      'reserva %s y habitación %s: %s',
      (reservationStatus, stayStatus, expected) => {
        expect(
          aDirectRoom({ stayStatus }).blocksInventory(reservationStatus),
        ).toBe(expected);
      },
    );

    it('una habitación sin asignar nunca bloquea', () => {
      const room = anOtaRoom({ roomId: null, roomNumber: null });

      expect(room.isAssigned).toBe(false);
      expect(room.blocksInventory('ACTIVE')).toBe(false);
    });
  });

  it.each([0, -1, 1.5])('se rechaza con %s personas', (guestCount) => {
    expect(() => aDirectRoom({ guestCount })).toThrow(
      expect.objectContaining({
        errorCode: 'GUEST_COUNT_TOO_LOW',
        message: 'Cada habitación debe tener al menos una persona.',
      }),
    );
  });

  it('roomId y roomNumber van los dos o ninguno', () => {
    expect(() => aDirectRoom({ roomNumber: null })).toThrow(/roomNumber/);
    expect(() => anOtaRoom({ roomId: null })).toThrow(/roomNumber/);
  });
});
