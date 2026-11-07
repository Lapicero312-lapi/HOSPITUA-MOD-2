import { Controller, Get, Inject } from '@nestjs/common';
import {
  GET_REFERENCE_RATES,
  type GetReferenceRates,
} from '../../../application/use-cases/calculate-dynamic-rate/ports/in/get-reference-rates.port.js';
import type { ReferenceRate } from '../../../domain/rate/reference-rate.js';
import type { Money } from '../../../domain/shared/money.js';

/** El texto fijo de C1: la tarifa real sale de la cotización. */
const REFERENCE_NOTE =
  'Referencia ilustrativa. La tarifa real se obtiene al cotizar.';

type MoneyDto = { amount: string; currency: string };

/** Una fila de la pantalla "Tarifas" (C1). */
type ReferenceRateDto = {
  categoryRoom: string;
  baseRate: MoneyDto;
  seasonAdjustmentPercentage: string;
  effectiveRate: MoneyDto;
};

/** La pantalla "Tarifas" de la Recepcionista (plan de `calculate-dynamic-rate`, C1). */
@Controller('rates')
export class RatesController {
  constructor(
    @Inject(GET_REFERENCE_RATES)
    private readonly referenceRates: GetReferenceRates,
  ) {}

  /**
   * C1, `GET /api/rates/reference`: la tarifa base, el ajuste de temporada y la tarifa vigente de cada
   * categoría de la configuración, con la nota de que es ilustrativa. No llama al Módulo 3 ni guarda nada.
   */
  @Get('reference')
  list(): { items: ReferenceRateDto[]; note: string } {
    return {
      items: this.referenceRates.execute().map(toDto),
      note: REFERENCE_NOTE,
    };
  }
}

function toDto(rate: ReferenceRate): ReferenceRateDto {
  return {
    categoryRoom: rate.categoryRoom,
    baseRate: moneyDto(rate.baseRate),
    seasonAdjustmentPercentage: rate.seasonAdjustmentPercentage,
    effectiveRate: moneyDto(rate.effectiveRate),
  };
}

/** Los importes salen con dos decimales y su moneda (punto 12). */
function moneyDto(money: Money): MoneyDto {
  return { amount: money.amountWithCents, currency: money.currency };
}
