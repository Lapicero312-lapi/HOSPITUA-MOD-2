import { Decimal } from 'decimal.js';
import { BusinessError } from '../shared/business-error.js';
import { Money } from '../shared/money.js';

/**
 * Las habitaciones de la reserva tienen monedas distintas (plan de `calculate-dynamic-rate`, B3). Lo lanza
 * el dominio, así que se declara aquí y no en `application/`.
 */
export const CURRENCY_MISMATCH = {
  code: 'CURRENCY_MISMATCH',
  message: 'Las tarifas de la reserva no tienen la misma moneda.',
} as const;

/**
 * Total de la reserva: la suma de los importes de sus habitaciones (plan de `calculate-dynamic-rate`, B3).
 * No se guarda: se calcula al mostrarlo (FR-002). Todas deben tener la misma moneda; si no,
 * `CURRENCY_MISMATCH`. Suma con `decimal.js`: nunca pasa por `number`.
 */
export function reservationTotal(amounts: [Money, ...Money[]]): Money {
  const [first, ...rest] = amounts;
  if (rest.some((amount) => amount.currency !== first.currency)) {
    throw new BusinessError(CURRENCY_MISMATCH.code, CURRENCY_MISMATCH.message);
  }

  const total = rest.reduce(
    (sum, amount) => sum.plus(amount.amount),
    new Decimal(first.amount),
  );
  return Money.of(total.toFixed(), first.currency);
}
