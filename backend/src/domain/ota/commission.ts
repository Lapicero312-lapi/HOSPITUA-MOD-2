import { Decimal } from 'decimal.js';
import { Money } from '../shared/money.js';

/**
 * Comisión de la agencia por una reserva (plan de `register-ota-information-commission`, regla 1; plan
 * base, C7): `grossAmount × commissionPercentage / 100`, con `decimal.js`, dos decimales y redondeo
 * `ROUND_HALF_UP`, en la moneda del `grossAmount`. Nunca pasa por `number`.
 *
 * Recibe el porcentaje ya validado (de 0 a 100): no lo revisa.
 */
export function calculateCommission(
  grossAmount: Money,
  commissionPercentage: string,
): Money {
  const commission = new Decimal(grossAmount.amount)
    .times(commissionPercentage)
    .dividedBy(100)
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  return Money.of(commission.toFixed(2), grossAmount.currency);
}
