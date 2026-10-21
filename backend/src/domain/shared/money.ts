import { Decimal } from 'decimal.js';

/**
 * Copia local de `decimal.js` con redondeo `ROUND_HALF_UP` (plan base): el redondeo de `Money` no
 * depende de la configuración global de la librería.
 */
const MoneyDecimal = Decimal.clone({ rounding: Decimal.ROUND_HALF_UP });

/**
 * Dinero con su moneda. Guarda siempre el valor exacto y nunca pasa por `number`: se crea desde texto
 * y solo se redondea cuando se pide con `roundToTwoDecimals`.
 */
export class Money {
  private constructor(
    private readonly value: Decimal,
    readonly currency: string,
  ) {}

  static of(amount: string, currency: string): Money {
    return new Money(new MoneyDecimal(amount), currency);
  }

  /** El importe como texto decimal con dos decimales; si tiene más, se muestran todos, sin redondear. */
  get amount(): string {
    return this.value.decimalPlaces() > 2
      ? this.value.toFixed()
      : this.value.toFixed(2);
  }

  plus(other: Money): Money {
    return new Money(this.value.plus(other.value), this.currency);
  }

  times(factor: string): Money {
    return new Money(this.value.times(factor), this.currency);
  }

  dividedBy(divisor: string): Money {
    return new Money(this.value.dividedBy(divisor), this.currency);
  }

  /** Redondea a dos decimales con `ROUND_HALF_UP`. */
  roundToTwoDecimals(): Money {
    return new Money(
      this.value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
      this.currency,
    );
  }

  equals(other: Money): boolean {
    return other.currency === this.currency && this.value.equals(other.value);
  }

  isGreaterThanZero(): boolean {
    return this.value.greaterThan('0');
  }
}
