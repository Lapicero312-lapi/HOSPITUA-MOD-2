import { describe, expect, it } from 'vitest';
import { isPercentage } from '../../../../src/domain/ota/ota.js';
import { anOta } from '../../../support/builders.js';

describe('Ota', () => {
  it('guarda sus datos', () => {
    const ota = anOta();

    expect(ota.name).toBe('Booking.com');
    expect(ota.commissionPercentage).toBe('15');
    expect(ota.connectionStatus).toBe('CONNECTED');
  });

  it('dice qué campos son inválidos', () => {
    expect(() =>
      anOta({ name: ' ', hotelAccountId: '', commissionPercentage: '101' }),
    ).toThrow(
      expect.objectContaining({
        errorCode: 'INVALID_OTA_DATA',
        message:
          'Datos de la agencia inválidos: name, hotelAccountId, commissionPercentage.',
      }),
    );
  });
});

describe('isPercentage', () => {
  it.each(['0', '15', '15.5', '15.25', '100', '100.00'])(
    '%s es un porcentaje de 0 a 100',
    (value) => {
      expect(isPercentage(value)).toBe(true);
    },
  );

  it.each(['-1', '100.01', '101', '15.123', 'abc', '', '1e2'])(
    '%s no lo es',
    (value) => {
      expect(isPercentage(value)).toBe(false);
    },
  );
});
