import { Money } from '../../../../src/domain/shared/money.js';

describe('Money', () => {
  describe('valor exacto', () => {
    it('se crea desde texto y conserva el importe y la moneda', () => {
      const money = Money.of('530000.00', 'COP');

      expect(money.amount).toBe('530000.00');
      expect(money.currency).toBe('COP');
    });

    it('suma sin errores de coma flotante', () => {
      const total = Money.of('0.1', 'COP').plus(Money.of('0.2', 'COP'));

      expect(total.amount).toBe('0.30');
    });

    it('no redondea por su cuenta: si hay más de dos decimales, los conserva', () => {
      expect(Money.of('12.345', 'USD').amount).toBe('12.345');
    });

    it('el importe siempre se muestra con al menos dos decimales', () => {
      expect(Money.of('530000', 'COP').amount).toBe('530000.00');
      expect(Money.of('60.5', 'USD').amount).toBe('60.50');
    });

    it('admite importes negativos', () => {
      const difference = Money.of('250000.00', 'COP').plus(
        Money.of('-280000.00', 'COP'),
      );

      expect(difference.amount).toBe('-30000.00');
    });
  });

  describe('operaciones', () => {
    it('suma importes de la misma moneda', () => {
      const total = Money.of('250000.00', 'COP').plus(
        Money.of('280000.00', 'COP'),
      );

      expect(total.amount).toBe('530000.00');
      expect(total.currency).toBe('COP');
    });

    it('multiplica y divide con exactitud: 400 × 15 / 100 = 60.00', () => {
      const commission = Money.of('400.00', 'USD').times('15').dividedBy('100');

      expect(commission.amount).toBe('60.00');
      expect(commission.currency).toBe('USD');
    });

    it('compara importe y moneda', () => {
      expect(
        Money.of('530000', 'COP').equals(Money.of('530000.00', 'COP')),
      ).toBe(true);
      expect(
        Money.of('530000.00', 'COP').equals(Money.of('530000.01', 'COP')),
      ).toBe(false);
      expect(Money.of('400.00', 'USD').equals(Money.of('400.00', 'COP'))).toBe(
        false,
      );
    });

    it('dice si el importe es mayor que cero', () => {
      expect(Money.of('0.01', 'COP').isGreaterThanZero()).toBe(true);
      expect(Money.of('0.00', 'COP').isGreaterThanZero()).toBe(false);
      expect(Money.of('-1.00', 'COP').isGreaterThanZero()).toBe(false);
    });
  });

  describe('redondeo a dos decimales con ROUND_HALF_UP', () => {
    it.each([
      ['60.005', '60.01'],
      ['60.004', '60.00'],
      ['2.675', '2.68'],
      ['-0.005', '-0.01'],
    ])('%s se redondea a %s', (exact, rounded) => {
      expect(Money.of(exact, 'USD').roundToTwoDecimals().amount).toBe(rounded);
    });

    it('no cambia el valor original', () => {
      const exact = Money.of('60.005', 'USD');
      exact.roundToTwoDecimals();

      expect(exact.amount).toBe('60.005');
    });
  });
});
