import type { ReservationForBilling } from '../../../application/use-cases/check-view-reservation/ports/in/get-reservation-for-billing.port.js';

/** La respuesta de `GET /api/reservations/{reservationRef}` con `X-Client: MODULE3` (C4). */
export type ReservationBillingBody = {
  reservationRef: string;
  channel: 'DIRECT' | 'OTA';
  quoteIds: string[];
  /** Solo si `channel` es `OTA`. */
  otaId?: string;
  otaConfirmationCode?: string;
  /** Número JSON de 0 a 100 con hasta dos decimales. */
  otaCommissionPercentage?: number;
};

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
