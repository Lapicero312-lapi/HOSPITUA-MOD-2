import { apiRequest } from './api-client.ts';
import type { ReservationDetail } from './reservation-detail.ts';

/** El dinero como texto decimal con dos decimales y su moneda (plan base, "Dinero"): nunca un número. */
export type Money = { amount: string; currency: string };

/** Los tipos de documento del titular (plan de `generate-direct-reservation`, B). */
export const DOCUMENT_TYPES = [
  { value: 'CC', label: 'Cédula de ciudadanía' },
  { value: 'CE', label: 'Cédula de extranjería' },
  { value: 'PAS', label: 'Pasaporte' },
  { value: 'TI', label: 'Tarjeta de Identidad' },
  { value: 'RC', label: 'Registro Civil' },
  { value: 'NIT', label: 'NIT' },
] as const;

/** Máximo de observaciones (regla 2 del plan). */
export const MAX_NOTES_LENGTH = 500;
/** De 1 a 10 habitaciones por reserva (FR-005). */
export const MAX_ROOMS = 10;

/** La solicitud de la vista previa (A): una sola categoría y una entrada por habitación. */
export type DirectPreviewRequest = {
  startDate: string;
  endDate: string;
  categoryRoom: string;
  rooms: { guestCount: number }[];
};

/** La respuesta de la vista previa (A). */
export type DirectPreview = {
  availability: {
    startDate: string;
    endDate: string;
    categoryRoom: string;
    availableCount: number;
  };
  assignedRooms: {
    position: number;
    roomId: string;
    roomNumber: string;
    maxCapacity: number;
    guestCount: number;
  }[];
  quotes: {
    rooms: {
      key: string;
      categoryRoom: string;
      nights: number;
      nightlyRates: { date: string; rate: Money }[];
      lodgingAmount: Money;
    }[];
    total: Money;
  };
  reservation: { guestCount: number };
};

/** El titular de la reserva (B). */
export type DirectGuest = {
  firstName: string;
  lastName: string;
  documentType: string;
  documentNumber: string;
  nationality: string;
  contactPhone: string | null;
  contactEmail: string | null;
};

/** La solicitud de la creación (B): la de la vista previa, el titular, las notas y las tarifas vistas. */
export type DirectCreationRequest = DirectPreviewRequest & {
  guest: DirectGuest;
  notes: string | null;
  expectedRates: {
    position: number;
    lodgingAmount: string;
    currency: string;
  }[];
};

/**
 * `POST /api/reservations/direct/preview` (A): la disponibilidad, las habitaciones asignadas y la tarifa de
 * cada una, sin guardar nada.
 * @throws ApiError con el error de la tabla C (por ejemplo `NO_AVAILABILITY`).
 */
export function previewDirectReservation(
  body: DirectPreviewRequest,
  signal?: AbortSignal,
): Promise<DirectPreview> {
  return apiRequest<DirectPreview>('/reservations/direct/preview', {
    method: 'POST',
    body,
    signal,
  });
}

/**
 * `POST /api/reservations/direct` (B): crea la reserva y devuelve su detalle (C3). La `Idempotency-Key` la
 * genera la pantalla una vez por formulario: si la misma solicitud llega dos veces, se crea una sola
 * reserva (FR-008).
 * @throws ApiError con el error de la tabla C (por ejemplo `RATE_CHANGED`).
 */
export function createDirectReservation(
  body: DirectCreationRequest,
  idempotencyKey: string,
): Promise<ReservationDetail> {
  return apiRequest<ReservationDetail>('/reservations/direct', {
    method: 'POST',
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

/** La respuesta de la precarga del titular (E). */
export type GuestLookup =
  { found: true; guest: DirectGuest } | { found: false; guest: null };

/**
 * `GET /api/guests/lookup` (E): el titular de la reserva más reciente con ese documento, para precargar el
 * formulario.
 * @throws ApiError `GUEST_DATA_REQUIRED`, `INVALID_DOCUMENT_TYPE` o `INVALID_CHARACTERS`.
 */
export function lookupGuest(
  documentType: string,
  documentNumber: string,
): Promise<GuestLookup> {
  const query = new URLSearchParams({ documentType, documentNumber });
  return apiRequest<GuestLookup>(`/guests/lookup?${query.toString()}`);
}
