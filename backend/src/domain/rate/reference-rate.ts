import { Decimal } from 'decimal.js';
import { Money } from '../shared/money.js';

/**
 * La tarifa de referencia de una categoría para la pantalla "Tarifas" (plan de `calculate-dynamic-rate`,
 * C1, FR-009). Es ilustrativa: es un tipo distinto de `RoomQuote` y no hay conversión entre ambos, así que
 * nunca se usa como `roomGrossAmount`.
 */
export type ReferenceRate = {
  categoryRoom: string;
  baseRate: Money;
  /** El ajuste de temporada, con dos decimales (`"15.00"`); negativo en temporada baja. */
  seasonAdjustmentPercentage: string;
  /** `baseRate × (1 + seasonAdjustmentPercentage / 100)`, con dos decimales y `ROUND_HALF_UP`. */
  effectiveRate: Money;
};

/**
 * La tarifa de referencia de una categoría (C1 y punto 12): el `effectiveRate` se calcula con `decimal.js`
 * y se redondea a dos decimales con `ROUND_HALF_UP`, como la comisión. Nunca pasa por `number`.
 * Recibe el porcentaje ya validado (mayor que -100 y hasta 100): no lo revisa.
 */
export function referenceRateOf(
  categoryRoom: string,
  baseRate: Money,
  seasonAdjustmentPercentage: string,
): ReferenceRate {
  const effective = new Decimal(baseRate.amount)
    .times(new Decimal(100).plus(seasonAdjustmentPercentage))
    .dividedBy(100)
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  return {
    categoryRoom,
    baseRate,
    seasonAdjustmentPercentage: new Decimal(seasonAdjustmentPercentage).toFixed(
      2,
    ),
    effectiveRate: Money.of(effective.toFixed(2), baseRate.currency),
  };
}
