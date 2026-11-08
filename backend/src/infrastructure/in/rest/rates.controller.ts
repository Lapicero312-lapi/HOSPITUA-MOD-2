import { Controller, Get, Inject } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
} from '@nestjs/swagger';
import {
  GET_REFERENCE_RATES,
  type GetReferenceRates,
} from '../../../application/use-cases/calculate-dynamic-rate/ports/in/get-reference-rates.port.js';
import type { ReferenceRate } from '../../../domain/rate/reference-rate.js';
import type { Money } from '../../../domain/shared/money.js';
import { ApiErrorBody } from '../../shared/api-error.js';
import type { MoneyDto } from './money.dto.js';
import {
  REFERENCE_RATES_ERROR_EXAMPLES,
  REFERENCE_RATES_EXAMPLE,
  type ReferenceRateDto,
  ReferenceRatesDto,
} from './rates.dto.js';

/** El texto fijo de C1: la tarifa real sale de la cotización. */
const REFERENCE_NOTE =
  'Referencia ilustrativa. La tarifa real se obtiene al cotizar.';

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
  @ApiOperation({
    summary:
      'La tarifa base, el ajuste de temporada ilustrativo y la tarifa efectiva resultante de cada categoría de `RATE_REFERENCE`, sin la capacidad de las habitaciones. No llama al Módulo 3 ni guarda nada (FR-009).',
  })
  @ApiOkResponse({
    type: ReferenceRatesDto,
    description:
      'Las tarifas de referencia. Sin `RATE_REFERENCE`: `items: []` con la misma `note`.',
    example: REFERENCE_RATES_EXAMPLE,
  })
  @ApiBadRequestResponse({
    type: ApiErrorBody,
    description: 'Una excepción inesperada (`REQUEST_NOT_PROCESSED`).',
    examples: REFERENCE_RATES_ERROR_EXAMPLES,
  })
  list(): ReferenceRatesDto {
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
