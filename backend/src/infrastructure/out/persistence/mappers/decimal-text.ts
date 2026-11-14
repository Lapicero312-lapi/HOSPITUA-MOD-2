import { Decimal } from 'decimal.js';

/**
 * Un `numeric` de PostgreSQL como texto decimal sin ceros de sobra (`15.00` → `15`), la misma forma que
 * `Money.amount`. Así un valor leído de la base es igual al que se guardó.
 */
export function decimalText(value: string): string {
  return new Decimal(value).toFixed();
}
