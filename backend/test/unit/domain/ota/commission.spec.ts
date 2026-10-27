import { describe, expect, it } from 'vitest';
import { calculateCommission } from '../../../../src/domain/ota/commission.js';
import { Money } from '../../../../src/domain/shared/money.js';

/**
 * Datos del plan ("Pruebas por escenario", NFR-002). `Money.amount` lee el importe sin ceros finales
 * (`60.00` se lee `60`).
 */
describe('calculateCommission', () => {
  it.each([
    ['400.00 × 15 % (ejemplo de la regla 1)', '400.00', '15', '60'],
    ['100.30 × 15 %: 15.045 sube a 15.05', '100.30', '15', '15.05'],
    ['0.10 × 15 %: 0.015 sube a 0.02', '0.10', '15', '0.02'],
    ['333.33 × 15 %: 49.9995 sube a 50.00', '333.33', '15', '50'],
    [
      '100.10 × 14.95 %: 14.96495 queda en 14.96 (se redondea una sola vez)',
      '100.10',
      '14.95',
      '14.96',
    ],
    ['1000.00 × 0 %', '1000.00', '0', '0'],
    ['250000.00 × 100 %', '250000.00', '100', '250000'],
  ])('%s', (_, grossAmount, commissionPercentage, expected) => {
    const commission = calculateCommission(
      Money.of(grossAmount, 'COP'),
      commissionPercentage,
    );

    expect(commission.amount).toBe(expected);
  });

  it('la comisión queda en la moneda del grossAmount', () => {
    expect(calculateCommission(Money.of('400.00', 'COP'), '15').currency).toBe(
      'COP',
    );
  });
});
