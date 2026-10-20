import { ApiProperty } from '@nestjs/swagger';

/**
 * Cuerpo de todo error de la API (plan base, "Errores"). Es una clase para poder documentarlo en
 * OpenAPI, por ejemplo con `@ApiBadRequestResponse({ type: ApiErrorBody })`.
 */
export class ApiErrorBody {
  @ApiProperty({ example: 'NO_AVAILABILITY' })
  errorCode: string;

  @ApiProperty({
    example: 'Ya no hay disponibilidad para las fechas solicitadas.',
  })
  message: string;

  @ApiProperty({ example: '2026-10-20T15:30:00.000Z', format: 'date-time' })
  timestamp: string;

  @ApiProperty({ example: '/api/reservations' })
  path: string;
}

/** Código y mensaje de los errores de forma de la solicitud que no traen uno propio. */
export const INVALID_REQUEST = 'INVALID_REQUEST';
export const INVALID_REQUEST_MESSAGE = 'La solicitud no es válida.';

/** Código y mensaje de toda excepción inesperada (planes de los casos de uso). */
export const REQUEST_NOT_PROCESSED = 'REQUEST_NOT_PROCESSED';
export const REQUEST_NOT_PROCESSED_MESSAGE =
  'No fue posible procesar la solicitud.';

/**
 * Error de la API con su código HTTP. Lo lanzan los adaptadores de entrada (controladores,
 * validación de los DTO, el limitador de SIRE); los casos de uso lanzan `BusinessError`, que el filtro
 * global traduce a un `ApiError`.
 *
 * El estado siempre es 4xx (400 por defecto): el diccionario prohíbe responder 5xx, 2xx o 3xx para un
 * error, y el filtro corrige a 400 cualquier otro valor. `retryAfterSeconds` agrega la cabecera
 * `Retry-After` (respuesta 429 de la exportación SIRE).
 */
export class ApiError extends Error {
  constructor(
    readonly errorCode: string,
    message: string,
    readonly status: number = 400,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = new.target.name;
  }
}
