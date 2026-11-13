import { ApiProperty } from '@nestjs/swagger';
import {
  REQUEST_NOT_PROCESSED,
  REQUEST_NOT_PROCESSED_MESSAGE,
} from '../../shared/api-error.js';
import { errorExample, INVALID_CLIENT_EXAMPLE } from './openapi-examples.js';

/**
 * La respuesta de C2 (plan de `check-view-reservation`) como clase, para que OpenAPI la describa. El
 * controlador devuelve el `DaySummary` del caso de uso, que tiene esta misma forma.
 */
export class DaySummaryDto {
  @ApiProperty({ format: 'date', example: '2026-10-09' })
  operationalDate: string;

  @ApiProperty({
    description:
      'Reservas `ACTIVE` o `PENDING` con `startDate` igual al día operativo.',
    example: 2,
  })
  expectedArrivals: number;

  @ApiProperty({
    description: 'Reservas `IN_PROGRESS` con `endDate` igual al día operativo.',
    example: 0,
  })
  expectedDepartures: number;
}

/** El ejemplo de C2 del plan. */
export const DAY_SUMMARY_EXAMPLE = {
  operationalDate: '2026-10-09',
  expectedArrivals: 2,
  expectedDepartures: 0,
};

const DAY_SUMMARY_PATH = '/api/reservations/day-summary';

/** Los errores de C2: `X-Client` y la excepción inesperada. */
export const DAY_SUMMARY_ERROR_EXAMPLES = {
  INVALID_CLIENT: INVALID_CLIENT_EXAMPLE(DAY_SUMMARY_PATH),
  [REQUEST_NOT_PROCESSED]: errorExample(
    DAY_SUMMARY_PATH,
    'Una excepción inesperada',
    REQUEST_NOT_PROCESSED,
    REQUEST_NOT_PROCESSED_MESSAGE,
  ),
};
