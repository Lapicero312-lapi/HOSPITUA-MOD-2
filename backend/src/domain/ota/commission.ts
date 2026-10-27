import { Decimal } from 'decimal.js';
import type { CommissionStatus } from '../shared/enums.js';
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

/**
 * Transiciones de `commissionStatus` (plan de `register-ota-information-commission`, A2 y punto 5:
 * `CALCULATED → RECONCILED`, `CALCULATED → PAID` y `RECONCILED → PAID`). Cualquier otra se rechaza.
 */
const COMMISSION_TRANSITIONS: Record<
  CommissionStatus,
  readonly CommissionStatus[]
> = {
  CALCULATED: ['RECONCILED', 'PAID'],
  RECONCILED: ['PAID'],
  PAID: [],
};

/**
 * Si la comisión puede pasar de `from` a `to`. Quedarse en el mismo estado no es una transición: en la
 * conciliación es un reenvío (`ALREADY_APPLIED`).
 */
export function canChangeCommissionStatus(
  from: CommissionStatus,
  to: CommissionStatus,
): boolean {
  return COMMISSION_TRANSITIONS[from].includes(to);
}
