import { Money } from '../../../../src/domain/shared/money.js';

describe('Money', () => {
  it('se crea desde texto y conserva la moneda', () => {
    const money = Money.of('250000.00', 'COP');

    expect(money.amount).toBe('250000');
    expect(money.currency).toBe('COP');
  });

  it('conserva el valor exacto aunque tenga más dígitos de los que soporta un number', () => {
    expect(Money.of('1234567890123.456789', 'COP').amount).toBe(
      '1234567890123.456789',
    );
  });
});
