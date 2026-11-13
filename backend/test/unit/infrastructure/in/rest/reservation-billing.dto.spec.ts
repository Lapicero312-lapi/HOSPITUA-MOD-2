import { describe, expect, it } from 'vitest';
import { toReservationBillingBody } from '../../../../../src/infrastructure/in/rest/reservation-billing.dto.js';

describe('toReservationBillingBody (C4 de check-view-reservation, T032)', () => {
  it('una directa: solo la referencia, el canal y los quoteIds, sin los campos de la agencia', () => {
    const body = toReservationBillingBody({
      reservationRef: 'RSV-3F9A1C7B',
      channel: 'DIRECT',
      quoteIds: ['8b1f6c0e-7d1a-4c0b-9d5e-2f4f3b6a1c11'],
      ota: null,
    });

    expect(body).toEqual({
      reservationRef: 'RSV-3F9A1C7B',
      channel: 'DIRECT',
      quoteIds: ['8b1f6c0e-7d1a-4c0b-9d5e-2f4f3b6a1c11'],
    });
    expect(Object.keys(body)).not.toContain('otaId');
  });

  it.each([
    ['15.00', 15],
    ['12.50', 12.5],
    ['0', 0],
    ['100.00', 100],
  ])(
    'una de Booking: la agencia, su código y el porcentaje %s como el número %d',
    (commissionPercentage, expected) => {
      expect(
        toReservationBillingBody({
          reservationRef: 'RSV-8D02E5A4',
          channel: 'OTA',
          quoteIds: [],
          ota: {
            otaId: '5b0e7c1a-2f4d-4e8b-9c3a-1d6f8e2b7a90',
            confirmationCode: '4417829013',
            commissionPercentage,
          },
        }),
      ).toEqual({
        reservationRef: 'RSV-8D02E5A4',
        channel: 'OTA',
        quoteIds: [],
        otaId: '5b0e7c1a-2f4d-4e8b-9c3a-1d6f8e2b7a90',
        otaConfirmationCode: '4417829013',
        otaCommissionPercentage: expected,
      });
    },
  );
});
