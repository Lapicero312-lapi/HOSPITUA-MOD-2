import { describe, expect, it } from 'vitest';
import { commissionPercentageOf } from '../../../../src/domain/ota/commission.js';
import { isPercentage } from '../../../../src/domain/ota/ota.js';
import { Money } from '../../../../src/domain/shared/money.js';
import { anOta } from '../../../support/builders.js';

describe('Ota', () => {
  it('guarda sus datos', () => {
    const ota = anOta();

    expect(ota.name).toBe('Booking.com');
    expect(ota.commissionPercentage).toBe('15');
    expect(ota.connectionStatus).toBe('CONNECTED');
  });

  it('sin porcentaje es válida: lo calcula el sistema con su primera reserva', () => {
    const ota = anOta({ commissionPercentage: null });

    expect(ota.commissionPercentage).toBeNull();
  });

  it('dice qué campos son inválidos', () => {
    expect(() => anOta({ name: ' ', commissionPercentage: '101' })).toThrow(
      expect.objectContaining({
        errorCode: 'INVALID_OTA_DATA',
        message: 'Datos de la agencia inválidos: name, commissionPercentage.',
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

describe('commissionPercentageOf', () => {
  const usd = (amount: string) => Money.of(amount, 'USD');

  it.each([
    ['60.00', '400.00', '15.00'],
    ['10.00', '153.00', '6.54'],
    ['0.00', '400.00', '0.00'],
    ['400.00', '400.00', '100.00'],
    ['0.01', '300.00', '0.00'],
  ])(
    '%s de %s es el %s %%, con dos decimales y ROUND_HALF_UP',
    (commission, gross, expected) => {
      expect(commissionPercentageOf(usd(commission), usd(gross))).toBe(
        expected,
      );
    },
  );

  it('redondea la mitad hacia arriba: 1.0005 de 10 es 10.005 % y queda en 10.01', () => {
    expect(commissionPercentageOf(usd('1.0005'), usd('10'))).toBe('10.01');
  });
});
