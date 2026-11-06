import { Decimal } from 'decimal.js';

/**
 * Copia local de `decimal.js` con redondeo `ROUND_HALF_UP` (plan base): el redondeo de `Money` no
 * depende de la configuración global de la librería.
 */
const MoneyDecimal = Decimal.clone({ rounding: Decimal.ROUND_HALF_UP });

/** Dinero con su moneda, con `decimal.js`: se crea desde texto y nunca pasa por `number` (plan base). */
export class Money {
  private constructor(
    private readonly value: Decimal,
    readonly currency: string,
  ) {}

  static of(amount: string, currency: string): Money {
    return new Money(new MoneyDecimal(amount), currency);
  }

  /** El importe exacto, como texto. */
  get amount(): string {
    return this.value.toFixed();
  }

  /** El importe con dos decimales, como texto (`250000` → `250000.00`), para mostrarlo. */
  get amountWithCents(): string {
    return this.value.toFixed(2);
  }

  /** El mismo valor y la misma moneda: `530000` y `530000.00` son iguales. */
  equals(other: Money): boolean {
    return this.currency === other.currency && this.value.equals(other.value);
  }
}
