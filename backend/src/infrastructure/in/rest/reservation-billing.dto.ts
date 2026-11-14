import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { ReservationForBilling } from '../../../application/use-cases/check-view-reservation/ports/in/get-reservation-for-billing.port.js';
import { RESERVATION_NOT_FOUND } from '../../../domain/shared/error-codes.js';
import { RESERVATION_SOURCES } from '../../../domain/shared/enums.js';
import { errorExample } from './openapi-examples.js';

/**
 * La respuesta de `GET /api/reservations/{reservationRef}` con `X-Client: MODULE3` (C4). Es una clase, y no
 * un tipo, para que OpenAPI la describa (plan, "OpenAPI (T037) y pruebas de contrato (T034)").
 */
export class ReservationBillingDto {
  @ApiProperty({ pattern: '^RSV-[0-9A-F]{8}$', example: 'RSV-3F9A1C7B' })
  reservationRef: string;

  @ApiProperty({ enum: RESERVATION_SOURCES, example: 'DIRECT' })
  channel: 'DIRECT' | 'OTA';

  @ApiProperty({
    type: [String],
    description:
      'El `quoteId` de cada habitación, una cotización por habitación. Vacía en reservas `OTA`.',
    example: ['8b1f6c0e-7d1a-4c0b-9d5e-2f4f3b6a1c11'],
  })
  quoteIds: string[];

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Solo si `channel` es `OTA`.',
    example: '5b0e7c1a-2f4d-4e8b-9c3a-1d6f8e2b7a90',
  })
  otaId?: string;

  @ApiPropertyOptional({
    description: 'Solo si `channel` es `OTA`.',
    example: '4417829013',
  })
  otaConfirmationCode?: string;

  @ApiPropertyOptional({
    type: Number,
    minimum: 0,
    maximum: 100,
    description:
      'Solo si `channel` es `OTA`: el porcentaje congelado en la reserva, como número JSON de 0 a 100 con hasta dos decimales.',
    example: 15,
  })
  otaCommissionPercentage?: number;
}

/** La respuesta de C4: la misma clase. */
export type ReservationBillingBody = ReservationBillingDto;

/**
 * Convierte la consulta del Módulo 3 en el JSON de C4: los campos de la agencia solo en reservas `OTA`, con
 * el porcentaje como número (plan, "Consulta del Módulo 3").
 */
export function toReservationBillingBody({
  reservationRef,
  channel,
  quoteIds,
  ota,
}: ReservationForBilling): ReservationBillingBody {
  const body: ReservationBillingBody = { reservationRef, channel, quoteIds };
  if (channel === 'OTA' && ota !== null) {
    body.otaId = ota.otaId;
    body.otaConfirmationCode = ota.confirmationCode;
    body.otaCommissionPercentage = Number(ota.commissionPercentage);
  }
  return body;
}

/** Los dos ejemplos de C4 del plan: una reserva directa y una de Booking. */
export const BILLING_DIRECT_EXAMPLE: ReservationBillingBody = {
  reservationRef: 'RSV-3F9A1C7B',
  channel: 'DIRECT',
  quoteIds: ['8b1f6c0e-7d1a-4c0b-9d5e-2f4f3b6a1c11'],
};

export const BILLING_OTA_EXAMPLE: ReservationBillingBody = {
  reservationRef: 'RSV-8D02E5A4',
  channel: 'OTA',
  quoteIds: [],
  otaId: '5b0e7c1a-2f4d-4e8b-9c3a-1d6f8e2b7a90',
  otaConfirmationCode: '4417829013',
  otaCommissionPercentage: 15,
};

/** La `404` de C4: la única del Módulo 2 (plan base, "Errores"). */
export const BILLING_NOT_FOUND_EXAMPLE = errorExample(
  '/api/reservations/RSV-FFFFFFFF',
  'Módulo 3: la reserva no existe',
  RESERVATION_NOT_FOUND.code,
  RESERVATION_NOT_FOUND.message,
);
