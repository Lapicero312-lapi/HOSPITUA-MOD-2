import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CANCELLATION_NOT_CONFIRMED,
  OTA_RESERVATION_CANCEL_VIA_API,
  REASON_TOO_LONG,
  RESERVATION_REF_REQUIRED,
  STATUS_NOT_CANCELLABLE,
} from '../../../application/use-cases/cancel-reservation/error-codes.js';
import type { CancellationResult } from '../../../application/use-cases/cancel-reservation/ports/in/cancel-reservation.port.js';
import { colombiaTime } from '../../../application/use-cases/check-view-reservation/message-time.js';
import {
  CONCURRENT_UPDATE,
  INVALID_CHARACTERS,
  INVALID_RESERVATION_CODE,
  RESERVATION_NOT_FOUND,
} from '../../../domain/shared/error-codes.js';
import {
  type ApiErrorBody,
  REQUEST_NOT_PROCESSED,
  REQUEST_NOT_PROCESSED_MESSAGE,
} from '../../shared/api-error.js';

/** El cuerpo de la respuesta 200 de la cancelación (plan de `cancel-reservation`, contrato A). */
export type ReservationCancellationBody = Omit<
  CancellationResult,
  'cancellation'
> & {
  cancellation: Omit<CancellationResult['cancellation'], 'cancellationDate'> & {
    /** En hora de Colombia, con segundos: `2026-10-09T10:15:20-05:00`. */
    cancellationDate: string;
  };
};

/** Escribe la cancelación como la recibe la pantalla: el instante pasa a hora de Colombia. */
export function toReservationCancellationBody(
  result: CancellationResult,
): ReservationCancellationBody {
  return {
    ...result,
    cancellation: {
      ...result.cancellation,
      cancellationDate: colombiaTime(result.cancellation.cancellationDate),
    },
  };
}

/*
 * La documentación OpenAPI de la cancelación de la Recepcionista (plan de `cancel-reservation`, contrato A y
 * tabla C, punto 11; T015). Las clases existen para que OpenAPI describa los cuerpos (plan base, "Contratos
 * REST"): un `type` no se puede leer. Los ejemplos son los del plan. B no tiene ruta: es el puerto
 * `CancelReservation`, que `generate-ota-reservation` llama por dentro, así que no se documenta aquí.
 */

/** `RSV-` y 8 caracteres hexadecimales en mayúscula (plan base). */
export const RESERVATION_REF_PATTERN = '^RSV-[0-9A-F]{8}$';

/** La reserva de los ejemplos del plan. */
const EXAMPLE_REF = 'RSV-3F9A1C7B';
const EXAMPLE_PATH = `/api/reservations/${EXAMPLE_REF}/cancellation`;

/** El cuerpo de A, `POST /api/reservations/{reservationRef}/cancellation`. */
export class ReservationCancellationRequestDto {
  @ApiProperty({
    description:
      'El `updatedAt` que la pantalla leyó de la reserva (el detalle, C3 de `check-view-reservation`): es el control de concurrencia. Si no coincide, `CONCURRENT_UPDATE`.',
    example: '2026-10-08T15:42:10.123456-05:00',
  })
  updatedAt: string;

  @ApiProperty({
    type: Boolean,
    description:
      'La casilla "Entiendo que la cancelación no se puede deshacer" (FR-002b). Solo `true` confirma; si no, `CANCELLATION_NOT_CONFIRMED`.',
    example: true,
  })
  acknowledged: boolean;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 500,
    description:
      'El motivo, opcional: de máximo 500 caracteres (`REASON_TOO_LONG`) y sin caracteres de control salvo el salto de línea y la tabulación (`INVALID_CHARACTERS`).',
    example: 'El huésped cambió de planes',
  })
  reason?: string | null;
}

/** La solicitud del ejemplo de A. */
export const CANCELLATION_REQUEST_EXAMPLE = {
  updatedAt: '2026-10-08T15:42:10.123456-05:00',
  acknowledged: true,
  reason: 'El huésped cambió de planes',
};

/** La `Cancellation` registrada, dentro de la respuesta 200 de A. */
export class CancellationDto {
  @ApiProperty({
    format: 'uuid',
    example: '9d2f7c1a-4b3e-4f6a-8c5d-1e2f3a4b5c6d',
  })
  cancellationId: string;

  @ApiProperty({
    description: 'En hora de Colombia, con segundos.',
    example: '2026-10-09T10:15:20-05:00',
  })
  cancellationDate: string;

  @ApiProperty({
    enum: ['RECEPTION'],
    description:
      'Siempre `RECEPTION` en esta ruta. La cancelación de Booking (`OTA_API`) llega por el feed de Channex, sin ruta.',
    example: 'RECEPTION',
  })
  channel: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'El huésped cambió de planes',
  })
  reason: string | null;

  @ApiProperty({
    description: 'La Recepcionista de `X-User`, tal como llegó.',
    example: 'laura.mendez',
  })
  processedBy: string;

  @ApiProperty({ enum: ['COMPLETED'], example: 'COMPLETED' })
  status: string;
}

/** La respuesta 200 de A. */
export class ReservationCancellationDto {
  @ApiProperty({ pattern: RESERVATION_REF_PATTERN, example: EXAMPLE_REF })
  reservationRef: string;

  @ApiProperty({ enum: ['CANCELLED'], example: 'CANCELLED' })
  status: string;

  @ApiProperty({ type: CancellationDto })
  cancellation: CancellationDto;
}

/** La respuesta del ejemplo de A del plan. */
export const CANCELLATION_EXAMPLE: ReservationCancellationBody = {
  reservationRef: EXAMPLE_REF,
  status: 'CANCELLED',
  cancellation: {
    cancellationId: '9d2f7c1a-4b3e-4f6a-8c5d-1e2f3a4b5c6d',
    cancellationDate: '2026-10-09T10:15:20-05:00',
    channel: 'RECEPTION',
    reason: 'El huésped cambió de planes',
    processedBy: 'laura.mendez',
    status: 'COMPLETED',
  },
};

function errorExample(
  summary: string,
  errorCode: string,
  message: string,
  path = EXAMPLE_PATH,
) {
  return {
    summary,
    value: {
      errorCode,
      message,
      timestamp: '2026-10-09T15:15:20.000Z',
      path,
    } satisfies ApiErrorBody,
  };
}

/**
 * Un ejemplo por cada error de A: la cabecera `X-User` y después los códigos de la tabla C en el orden de la
 * regla 3 (la primera verificación que falla responde).
 */
export const CANCELLATION_ERROR_EXAMPLES = {
  USER_REQUIRED: errorExample(
    'Falta la cabecera `X-User`',
    'USER_REQUIRED',
    'Falta el usuario que hace la acción.',
  ),
  INVALID_USER: errorExample(
    '`X-User` de más de 100 caracteres',
    'INVALID_USER',
    'El usuario que hace la acción no es válido.',
  ),
  [RESERVATION_REF_REQUIRED.code]: errorExample(
    'La referencia viene vacía o solo con espacios',
    RESERVATION_REF_REQUIRED.code,
    RESERVATION_REF_REQUIRED.message,
    '/api/reservations//cancellation',
  ),
  [INVALID_RESERVATION_CODE.code]: errorExample(
    'La referencia no es `RSV-` más 8 hexadecimales en mayúscula',
    INVALID_RESERVATION_CODE.code,
    INVALID_RESERVATION_CODE.message,
    '/api/reservations/RSV-123/cancellation',
  ),
  [REASON_TOO_LONG.code]: errorExample(
    '`reason` de más de 500 caracteres',
    REASON_TOO_LONG.code,
    REASON_TOO_LONG.message,
  ),
  [INVALID_CHARACTERS.code]: errorExample(
    '`reason` con caracteres de control, o que no es texto',
    INVALID_CHARACTERS.code,
    INVALID_CHARACTERS.message,
  ),
  [RESERVATION_NOT_FOUND.code]: errorExample(
    'La reserva no existe',
    RESERVATION_NOT_FOUND.code,
    RESERVATION_NOT_FOUND.message,
  ),
  [OTA_RESERVATION_CANCEL_VIA_API.code]: errorExample(
    'Una reserva de Booking: su cancelación llega por el feed de Channex',
    OTA_RESERVATION_CANCEL_VIA_API.code,
    OTA_RESERVATION_CANCEL_VIA_API.message,
  ),
  [CANCELLATION_NOT_CONFIRMED.code]: errorExample(
    '`acknowledged` no es `true`',
    CANCELLATION_NOT_CONFIRMED.code,
    CANCELLATION_NOT_CONFIRMED.message,
  ),
  [CONCURRENT_UPDATE.code]: errorExample(
    '`updatedAt` no coincide: otra cancelación o cambio simultáneo',
    CONCURRENT_UPDATE.code,
    CONCURRENT_UPDATE.message,
  ),
  [STATUS_NOT_CANCELLABLE.code]: errorExample(
    'La reserva está en `IN_PROGRESS`, `COMPLETED`, `CANCELLED` o `NO_SHOW`',
    STATUS_NOT_CANCELLABLE.code,
    STATUS_NOT_CANCELLABLE.message,
  ),
  [REQUEST_NOT_PROCESSED]: errorExample(
    'Una excepción inesperada',
    REQUEST_NOT_PROCESSED,
    REQUEST_NOT_PROCESSED_MESSAGE,
  ),
};
