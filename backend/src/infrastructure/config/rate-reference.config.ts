import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ValidateBy } from 'class-validator';
import { Decimal } from 'decimal.js';
import {
  RATE_REFERENCE,
  type RateReferenceSettings,
} from '../../application/use-cases/calculate-dynamic-rate/ports/in/get-reference-rates.port.js';

/** Un decimal con hasta dos decimales, con signo opcional. */
const PERCENTAGE_FORMAT = /^-?\d+(\.\d{1,2})?$/;
/** Un decimal sin signo con hasta dos decimales. */
const AMOUNT_FORMAT = /^\d+(\.\d{1,2})?$/;
const CURRENCY_FORMAT = /^[A-Z]{3}$/;
/** La forma de `categoryRoom` (plan de `consult-room-inventory`, contrato A). */
const CATEGORY_ROOM_FORMAT = /^[A-Z0-9_]{1,50}$/;

/**
 * `RATE_REFERENCE` de la pantalla "Tarifas" (plan de `calculate-dynamic-rate`, C1 y punto 12): opcional y,
 * si viene, un JSON con `seasonAdjustmentPercentage` (decimal de hasta dos decimales, mayor que -100 y
 * hasta 100), `currency` (3 letras mayúsculas) y `baseRates` (al menos una categoría con la forma de
 * `categoryRoom`, cada una con un decimal positivo de hasta dos decimales). Ausente o vacía es válida.
 */
export function isValidRateReference(value: unknown): boolean {
  if (value === undefined || value === '') {
    return true;
  }
  if (typeof value !== 'string') {
    return false;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return false;
  }
  if (!isRecord(parsed)) {
    return false;
  }
  const { seasonAdjustmentPercentage, currency, baseRates } = parsed;
  return (
    isPercentage(seasonAdjustmentPercentage) &&
    typeof currency === 'string' &&
    CURRENCY_FORMAT.test(currency) &&
    isRecord(baseRates) &&
    Object.keys(baseRates).length > 0 &&
    Object.entries(baseRates).every(
      ([categoryRoom, rate]) =>
        CATEGORY_ROOM_FORMAT.test(categoryRoom) && isPositiveAmount(rate),
    )
  );
}

/**
 * La configuración ya validada, o `null` si `RATE_REFERENCE` no viene o está vacía.
 * @throws Error si no es válida: `validateEnv` ya la rechazó al arrancar, así que es un error del programa.
 */
export function parseRateReference(
  value: string | undefined,
): RateReferenceSettings | null {
  if (value === undefined || value === '') {
    return null;
  }
  if (!isValidRateReference(value)) {
    throw new Error('RATE_REFERENCE no es válida.');
  }
  const { seasonAdjustmentPercentage, currency, baseRates } = JSON.parse(
    value,
  ) as RateReferenceSettings;
  return { seasonAdjustmentPercentage, currency, baseRates: { ...baseRates } };
}

/**
 * La regla de `RATE_REFERENCE` para `EnvironmentVariables`. El mensaje nombra la variable y nunca su
 * valor, como las demás.
 */
export function IsRateReference(): PropertyDecorator {
  return ValidateBy({
    name: 'isRateReference',
    validator: {
      validate: isValidRateReference,
      defaultMessage: () =>
        'RATE_REFERENCE debe ser un JSON con seasonAdjustmentPercentage (de -100 a 100, sin incluir -100), currency (3 letras) y baseRates (categorías con su tarifa positiva)',
    },
  });
}

/**
 * Entrega `RATE_REFERENCE` desde la configuración validada. Es global: `GetReferenceRates` lo inyecta sin
 * importarlo, como `QUOTE_CONCURRENCY` de `Module3ClientModule`.
 */
@Global()
@Module({
  providers: [
    {
      provide: RATE_REFERENCE,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        parseRateReference(config.get<string>('RATE_REFERENCE')),
    },
  ],
  exports: [RATE_REFERENCE],
})
export class RateReferenceConfigModule {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPercentage(value: unknown): boolean {
  if (typeof value !== 'string' || !PERCENTAGE_FORMAT.test(value)) {
    return false;
  }
  const percentage = new Decimal(value);
  return percentage.gt(-100) && percentage.lte(100);
}

function isPositiveAmount(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    AMOUNT_FORMAT.test(value) &&
    new Decimal(value).gt(0)
  );
}
