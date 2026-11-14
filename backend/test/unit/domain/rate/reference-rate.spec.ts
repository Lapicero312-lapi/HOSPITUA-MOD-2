import { describe, expect, it } from 'vitest';
import { referenceRateOf } from '../../../../src/domain/rate/reference-rate.js';
import { Money } from '../../../../src/domain/shared/money.js';

const cop = (amount: string) => Money.of(amount, 'COP');

/** El importe y la moneda, para comparar sin depender de cómo guarda `Money` el número. */
const shown = (money: Money) => ({
  amount: money.amountWithCents,
  currency: money.currency,
});

describe('referenceRateOf (plan de calculate-dynamic-rate, C1 y punto 12)', () => {
  it('el ejemplo de C1: DOBLE a 220 000 con un ajuste de 15 % da 253 000', () => {
    const rate = referenceRateOf('DOBLE', cop('220000.00'), '15.00');

    expect(rate.categoryRoom).toBe('DOBLE');
    expect(shown(rate.baseRate)).toEqual({
      amount: '220000.00',
      currency: 'COP',
    });
    expect(rate.seasonAdjustmentPercentage).toBe('15.00');
    expect(shown(rate.effectiveRate)).toEqual({
      amount: '253000.00',
      currency: 'COP',
    });
  });

  it.each([
    ['un ajuste negativo (temporada baja)', '220000.00', '-10.00', '198000.00'],
    ['un ajuste en cero', '220000.00', '0', '220000.00'],
    ['el máximo de 100 %', '220000.00', '100', '440000.00'],
    ['un ajuste con decimales', '480000.00', '12.5', '540000.00'],
  ])('%s', (_, baseRate, percentage, effective) => {
    expect(
      referenceRateOf('DOBLE', cop(baseRate), percentage).effectiveRate
        .amountWithCents,
    ).toBe(effective);
  });

  it('redondea a dos decimales con ROUND_HALF_UP: 100.05 × 1.125 = 112.55625 → 112.56', () => {
    expect(
      referenceRateOf('DOBLE', cop('100.05'), '12.5').effectiveRate
        .amountWithCents,
    ).toBe('112.56');
  });

  it('la mitad exacta sube: 0.10 × 1.05 = 0.105 → 0.11', () => {
    expect(
      referenceRateOf('DOBLE', cop('0.10'), '5').effectiveRate.amountWithCents,
    ).toBe('0.11');
  });

  it('el porcentaje sale siempre con dos decimales', () => {
    expect(
      referenceRateOf('DOBLE', cop('220000'), '15').seasonAdjustmentPercentage,
    ).toBe('15.00');
  });

  it('la tarifa vigente va en la moneda de la base', () => {
    expect(
      referenceRateOf('DOBLE', Money.of('100', 'USD'), '15').effectiveRate
        .currency,
    ).toBe('USD');
  });
});
