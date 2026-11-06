import { describe, expect, it } from 'vitest';
import { Money } from '../../../../src/domain/shared/money.js';

describe('Money', () => {
  it('se crea desde texto, conserva la moneda y lee el importe exacto sin ceros finales', () => {
    const money = Money.of('250000.00', 'COP');

    expect(money.amount).toBe('250000');
    expect(money.currency).toBe('COP');
  });

  it('conserva exacto el mayor importe de una columna numeric(14,2)', () => {
    expect(Money.of('999999999999.99', 'COP').amount).toBe('999999999999.99');
  });

  describe('amountWithCents', () => {
    it.each([
      ['250000', '250000.00'],
      ['250000.5', '250000.50'],
      ['999999999999.99', '999999999999.99'],
      ['0', '0.00'],
    ])('%s se muestra como %s', (amount, shown) => {
      expect(Money.of(amount, 'COP').amountWithCents).toBe(shown);
    });
  });

  describe('equals', () => {
    it('el mismo valor y la misma moneda son iguales, aunque se escriban distinto', () => {
      expect(
        Money.of('530000', 'COP').equals(Money.of('530000.00', 'COP')),
      ).toBe(true);
    });

    it('otro valor no es igual, aunque difiera en un centavo', () => {
      expect(
        Money.of('530000.00', 'COP').equals(Money.of('530000.01', 'COP')),
      ).toBe(false);
    });

    it('otra moneda no es igual, aunque el valor sea el mismo', () => {
      expect(Money.of('530000', 'COP').equals(Money.of('530000', 'USD'))).toBe(
        false,
      );
    });
  });
});
