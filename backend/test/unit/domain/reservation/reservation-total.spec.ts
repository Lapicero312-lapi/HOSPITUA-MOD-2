import { describe, expect, it } from 'vitest';
import { reservationTotal } from '../../../../src/domain/reservation/reservation-total.js';
import { Money } from '../../../../src/domain/shared/money.js';

/** Datos del plan de `calculate-dynamic-rate`, "Pruebas por escenario" (FR-002, Total y Moneda única). */
describe('reservationTotal', () => {
  it('con una habitación, el total es su importe', () => {
    const total = reservationTotal([Money.of('530000.00', 'COP')]);

    expect(total.amount).toBe('530000');
    expect(total.currency).toBe('COP');
  });

  it('suma los importes de varias habitaciones con la misma moneda', () => {
    const total = reservationTotal([
      Money.of('530000.00', 'COP'),
      Money.of('350000.50', 'COP'),
    ]);

    expect(total.amount).toBe('880000.5');
    expect(total.currency).toBe('COP');
  });

  it('suma los decimales exactos, sin pasar por number', () => {
    const total = reservationTotal([
      Money.of('0.10', 'COP'),
      Money.of('0.20', 'COP'),
    ]);

    expect(total.amount).toBe('0.3');
  });

  it('con monedas distintas lanza CURRENCY_MISMATCH con el mensaje literal', () => {
    expect(() =>
      reservationTotal([
        Money.of('530000.00', 'COP'),
        Money.of('120.00', 'USD'),
      ]),
    ).toThrow(
      expect.objectContaining({
        errorCode: 'CURRENCY_MISMATCH',
        message: 'Las tarifas de la reserva no tienen la misma moneda.',
      }),
    );
  });
});
