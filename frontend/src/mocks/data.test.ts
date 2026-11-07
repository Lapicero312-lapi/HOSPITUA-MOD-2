import { describe, expect, it } from 'vitest';
import { RESERVATIONS } from './data';

describe('datos simulados', () => {
  it('respetan el contrato del plan', () => {
    RESERVATIONS.forEach((r) => {
      expect(r.reservationRef).toMatch(/^RSV-[0-9A-F]{8}$/);
      expect(r.endDate > r.startDate).toBe(true);
      r.rooms.forEach((x) =>
        expect(x.roomGrossAmount === null).toBe(r.source === 'OTA'),
      ); // OTA: sin valor por habitación
    });
    expect(new Set(RESERVATIONS.map((r) => r.reservationRef)).size).toBe(
      RESERVATIONS.length,
    );
  });
});
