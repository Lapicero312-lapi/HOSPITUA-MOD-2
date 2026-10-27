import { describe, expect, it } from 'vitest';
import {
  CURRENCY_MISMATCH,
  reservationTotal,
} from '../../../../src/domain/reservation/reservation-total.js';
import { BusinessError } from '../../../../src/domain/shared/business-error.js';
import { Money } from '../../../../src/domain/shared/money.js';

/** Lo que lanza `action`, para revisar el error. */
function thrownBy(action: () => void): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  throw new Error('No lanzó ningún error.');
}

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
    const error = thrownBy(() =>
      reservationTotal([
        Money.of('530000.00', 'COP'),
        Money.of('120.00', 'USD'),
      ]),
    );

    expect(error).toBeInstanceOf(BusinessError);
    expect(error).toMatchObject({
      errorCode: 'CURRENCY_MISMATCH',
      message: 'Las tarifas de la reserva no tienen la misma moneda.',
    });
    expect(CURRENCY_MISMATCH.code).toBe('CURRENCY_MISMATCH');
  });
});
