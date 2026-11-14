import { ApiProperty } from '@nestjs/swagger';
import {
  type ApiErrorBody,
  REQUEST_NOT_PROCESSED,
  REQUEST_NOT_PROCESSED_MESSAGE,
} from '../../shared/api-error.js';
import { MoneyDto } from './money.dto.js';

/**
 * Una fila de la pantalla "Tarifas" (plan de `calculate-dynamic-rate`, C1), sin la capacidad de las
 * habitaciones. Las clases de este archivo existen para que OpenAPI documente la respuesta de
 * `GET /api/rates/reference` (plan base, "Contratos REST"): un `type` no se puede leer.
 */
export class ReferenceRateDto {
  @ApiProperty({ pattern: '^[A-Z0-9_]{1,50}$', example: 'DOBLE' })
  categoryRoom: string;

  @ApiProperty({
    type: MoneyDto,
    description: 'La tarifa base de la categoría en `RATE_REFERENCE`.',
  })
  baseRate: MoneyDto;

  @ApiProperty({
    description:
      'El ajuste de temporada, el mismo para todas las categorías, con dos decimales: mayor que `-100` y hasta `100`, negativo en temporada baja.',
    pattern: '^-?\\d+\\.\\d{2}$',
    example: '15.00',
  })
  seasonAdjustmentPercentage: string;

  @ApiProperty({
    type: MoneyDto,
    description:
      '`baseRate × (1 + seasonAdjustmentPercentage / 100)`, redondeada a dos decimales con `ROUND_HALF_UP`.',
  })
  effectiveRate: MoneyDto;
}

/** La respuesta de C1, `GET /api/rates/reference`. */
export class ReferenceRatesDto {
  @ApiProperty({
    type: [ReferenceRateDto],
    description:
      'Ordenadas por `categoryRoom`. Sin `RATE_REFERENCE`, `[]` con la misma `note`.',
  })
  items: ReferenceRateDto[];

  @ApiProperty({
    description:
      'Siempre el mismo texto: la tarifa real sale de la cotización.',
    example: 'Referencia ilustrativa. La tarifa real se obtiene al cotizar.',
  })
  note: string;
}

/** El ejemplo de C1 del plan: la categoría `DOBLE` con un ajuste del 15 %. */
export const REFERENCE_RATES_EXAMPLE: ReferenceRatesDto = {
  items: [
    {
      categoryRoom: 'DOBLE',
      baseRate: { amount: '220000.00', currency: 'COP' },
      seasonAdjustmentPercentage: '15.00',
      effectiveRate: { amount: '253000.00', currency: 'COP' },
    },
  ],
  note: 'Referencia ilustrativa. La tarifa real se obtiene al cotizar.',
};

/**
 * El único error que puede responder `GET /api/rates/reference`: no tiene parámetros ni llama a otro
 * módulo, así que solo queda una excepción inesperada, que el filtro global responde con `400`
 * (plan de `calculate-dynamic-rate`, "Reglas de validación y manejo de errores").
 */
export const REFERENCE_RATES_ERROR_EXAMPLES = {
  [REQUEST_NOT_PROCESSED]: {
    summary: 'Una excepción inesperada',
    value: {
      errorCode: REQUEST_NOT_PROCESSED,
      message: REQUEST_NOT_PROCESSED_MESSAGE,
      timestamp: '2026-10-11T15:00:00.000Z',
      path: '/api/rates/reference',
    } satisfies ApiErrorBody,
  },
};
