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
});
