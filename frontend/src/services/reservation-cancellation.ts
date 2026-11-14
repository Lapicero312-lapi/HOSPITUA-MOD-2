import { apiRequest } from './api-client.ts';

/**
 * Lo que la pantalla "Cancelar reserva" necesita del detalle de la reserva (plan de
 * `check-view-reservation`, C3): con qué identificarla, si se puede cancelar y su `updatedAt`.
 */
export type ReservationToCancel = {
  reservationRef: string;
  status:
    | 'PENDING'
    | 'ACTIVE'
    | 'IN_PROGRESS'
    | 'COMPLETED'
    | 'CANCELLED'
    | 'NO_SHOW';
  source: 'DIRECT' | 'OTA';
  /** `AAAA-MM-DD`. */
  startDate: string;
  endDate: string;
  nights: number;
  guestCount: number;
  /**
   * La versión de la reserva, en hora de Colombia y con microsegundos: el control de concurrencia que se
   * envía al cancelar, tal como llegó.
   */
  updatedAt: string;
  rooms: { roomNumber: string | null; categoryRoom: string }[];
  guest: { firstName: string; lastName: string };
};

/** El cuerpo de la cancelación de la Recepcionista (plan de `cancel-reservation`, A). */
export type CancellationRequest = {
  /** El que la pantalla leyó de la reserva. */
  updatedAt: string;
  /** La casilla "Entiendo que la cancelación no se puede deshacer" (FR-002b). */
  acknowledged: true;
  /** Opcional, máximo 500 caracteres. */
  reason?: string;
};

/** La respuesta de la cancelación (A). */
export type CancellationResult = {
  reservationRef: string;
  status: 'CANCELLED';
  cancellation: {
    cancellationId: string;
    /** Con hora, en hora de Colombia. */
    cancellationDate: string;
    channel: 'RECEPTION' | 'OTA_API';
    reason: string | null;
    processedBy: string;
    status: string;
  };
};

/** El máximo de `reason` (tabla C de `cancel-reservation`, `REASON_TOO_LONG`). */
export const MAX_REASON_LENGTH = 500;

/**
 * `GET /api/reservations/{reservationRef}` (C3): la reserva que se va a cancelar.
 * @throws ApiError `RESERVATION_NOT_FOUND` o `INVALID_RESERVATION_CODE`.
 */
export function getReservationToCancel(
  reservationRef: string,
  signal?: AbortSignal,
): Promise<ReservationToCancel> {
  return apiRequest<ReservationToCancel>(
    `/reservations/${encodeURIComponent(reservationRef)}`,
    { signal },
  );
}

/**
 * `POST /api/reservations/{reservationRef}/cancellation` (A): la Recepcionista cancela una reserva
 * directa. El backend toma de `X-User` quién la procesa.
 * @throws ApiError con el error de la tabla C: `CONCURRENT_UPDATE`, `STATUS_NOT_CANCELLABLE`,
 * `OTA_RESERVATION_CANCEL_VIA_API`, `CANCELLATION_NOT_CONFIRMED`, `REASON_TOO_LONG`…
 */
export function cancelReservation(
  reservationRef: string,
  request: CancellationRequest,
): Promise<CancellationResult> {
  return apiRequest<CancellationResult>(
    `/reservations/${encodeURIComponent(reservationRef)}/cancellation`,
    { method: 'POST', body: request },
  );
}
