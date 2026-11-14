import { describe, expect, it } from 'vitest';
import {
  aDirectReservation,
  anOtaReservation,
} from '../../../support/builders.js';

const OTA_ID = '6f1b8c2a-3d4e-4f5a-8b6c-7d8e9f0a1b2c';
const DETECTED_AT = new Date('2026-11-10T15:00:00.000Z');

describe('Reservation.withConflict (B3 de generate-ota-reservation)', () => {
  it.each(['IN_PROGRESS', 'COMPLETED', 'NO_SHOW'] as const)(
    'una de Booking en %s queda con el conflicto y su hora; lo demás no cambia',
    (status) => {
      const reservation = anOtaReservation(OTA_ID, { status });

      const marked = reservation.withConflict(
        'CHANGE_NOT_APPLICABLE',
        DETECTED_AT,
      );

      expect(marked.conflict).toEqual({
        reason: 'CHANGE_NOT_APPLICABLE',
        detectedAt: DETECTED_AT,
      });
      expect(marked.status).toBe(status);
      expect(marked.id).toBe(reservation.id);
      expect(marked.reservationRef).toBe(reservation.reservationRef);
      expect(marked.rooms).toEqual(reservation.rooms);
      expect(marked.ota).toEqual(reservation.ota);
      expect(marked.updatedAt).toBe(reservation.updatedAt);
    },
  );

  it('no cambia la reserva original: devuelve otra', () => {
    const reservation = anOtaReservation(OTA_ID, { status: 'COMPLETED' });

    reservation.withConflict('CHANGE_NOT_APPLICABLE', DETECTED_AT);

    expect(reservation.conflict).toBeNull();
  });

  it('una reserva directa nunca está en conflicto: es un error del programa', () => {
    const reservation = aDirectReservation({ status: 'COMPLETED' });

    expect(() =>
      reservation.withConflict('CHANGE_NOT_APPLICABLE', DETECTED_AT),
    ).toThrow(`La reserva ${reservation.reservationRef} es directa`);
  });
});
