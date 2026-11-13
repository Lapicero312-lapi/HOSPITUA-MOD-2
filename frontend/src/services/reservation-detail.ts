import { apiRequest } from './api-client.ts';

/** El dinero como texto decimal con dos decimales y su moneda (plan base, "Dinero"): nunca un número. */
export type Money = { amount: string; currency: string };

export type DetailStatus =
  'PENDING' | 'ACTIVE' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';

/** El estado de una habitación dentro de la reserva. */
export type StayStatus =
  'EXPECTED' | 'CHECKED_IN' | 'CHECKED_OUT' | 'NOT_ARRIVED';

export type DetailRoom = {
  /** `null` en una habitación sin asignar (reserva de Booking en conflicto). */
  roomId: string | null;
  roomNumber: string | null;
  categoryRoom: string;
  guestCount: number;
  /** La tarifa de la habitación, informativa; `null` en reservas `OTA`. */
  roomGrossAmount: Money | null;
  stayStatus: StayStatus;
};

export type DetailGuest = {
  firstName: string;
  lastName: string;
  /** En reservas de Booking el titular puede venir sin documento. */
  documentType: string | null;
  documentNumber: string | null;
  nationality: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
};

/** La cancelación de una reserva `CANCELLED` por solicitud explícita. El No-Show no la tiene. */
export type DetailCancellation = {
  /** Con hora, en hora de Colombia (`2026-10-09T10:15:20-05:00`). */
  cancellationDate: string;
  channel: 'RECEPTION' | 'OTA_API';
  reason: string | null;
  processedBy: string;
};

/**
 * El detalle completo de una reserva (plan de `check-view-reservation`, C3; FR-006). Las fechas de la
 * estadía son `AAAA-MM-DD`; `createdAt` llega con hora, en hora de Colombia.
 */
export type ReservationDetail = {
  reservationRef: string;
  status: DetailStatus;
  source: 'DIRECT' | 'OTA';
  /** Solo en reservas `OTA`. */
  externalConfirmationCode: string | null;
  otaName: string | null;
  startDate: string;
  endDate: string;
  nights: number;
  /** El total de personas de la reserva. */
  guestCount: number;
  notes: string | null;
  createdAt: string | null;
  /** Solo en una reserva de Booking en conflicto: el motivo y desde cuándo. */
  conflict: { reason: string; detectedAt: string } | null;
  rooms: DetailRoom[];
  guest: DetailGuest;
  cancellation: DetailCancellation | null;
};

/**
 * `GET /api/reservations/{reservationRef}` (C3): el detalle completo de la reserva.
 * @throws ApiError `RESERVATION_NOT_FOUND` ("La reserva no existe.") o `INVALID_RESERVATION_CODE`.
 */
export function getReservationDetail(
  reservationRef: string,
  signal?: AbortSignal,
): Promise<ReservationDetail> {
  return apiRequest<ReservationDetail>(
    `/reservations/${encodeURIComponent(reservationRef)}`,
    { signal },
  );
}
