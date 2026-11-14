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

/** Máximo de observaciones (`NOTES_TOO_LONG`, tabla de errores de B del plan de `update-reservation`). */
export const MAX_NOTES_LENGTH = 500;
/** Entre 1 y 10 habitaciones (`INVALID_ROOM_COUNT`). */
export const MAX_ROOMS = 10;

/**
 * Lo que la pantalla "Modificar" necesita del detalle de la reserva (plan de `check-view-reservation`, C3):
 * lo que se puede cambiar, si se puede modificar y su `updatedAt`.
 */
export type ReservationToModify = {
  reservationRef: string;
  status: ReservationDetail['status'];
  source: 'DIRECT' | 'OTA';
  /** `AAAA-MM-DD`. */
  startDate: string;
  endDate: string;
  /**
   * La versión de la reserva, en hora de Colombia y con microsegundos: el control de concurrencia que se
   * envía al modificar, tal como llegó (FR-008).
   */
  updatedAt: string;
  rooms: {
    /** `null` solo en una habitación sin asignar de Booking; una reserva directa siempre la tiene. */
    roomId: string | null;
    roomNumber: string | null;
    categoryRoom: string;
    guestCount: number;
  }[];
  guest: {
    firstName: string;
    lastName: string;
    documentType: string | null;
    documentNumber: string | null;
    contactPhone: string | null;
    contactEmail: string | null;
  };
  notes: string | null;
};

/** Una habitación que queda en la reserva, por su `roomId` y con sus personas (B). */
export type RequestedRoom = { roomId: string; guestCount: number };

/** El titular del cambio: sin `nationality`, que se fija al crear la reserva (B). */
export type ModifiedGuest = {
  firstName: string;
  lastName: string;
  documentType: string;
  documentNumber: string;
  contactPhone: string | null;
  contactEmail: string | null;
};

/**
 * El cuerpo de cambio, el mismo en B1 y B2. Todo es opcional salvo `updatedAt`: lo que no se envía queda
 * igual. `rooms`, cuando viene, es la lista completa de habitaciones que quedan; `notes: null` borra las
 * observaciones.
 */
export type ModificationRequest = {
  updatedAt: string;
  startDate?: string;
  endDate?: string;
  rooms?: RequestedRoom[];
  guest?: ModifiedGuest;
  notes?: string | null;
};

/** La respuesta de la vista previa (B1). */
export type ModificationPreview = {
  reservationRef: string;
  changes: {
    dates: boolean;
    roomsAdded: string[];
    roomsRemoved: string[];
    roomsSwapped: unknown[];
    guestCountChanged: boolean;
    guestChanged: boolean;
    notesChanged: boolean;
  };
  requiresConfirmation: boolean;
  /** Las habitaciones verificadas: las que cambian de fechas o se agregan. */
  availability: {
    rooms: {
      roomId: string;
      roomNumber: string;
      available: boolean;
      /** Por qué no está disponible: reservada en esas fechas o en mantenimiento. */
      reason: 'RESERVED' | 'MAINTENANCE' | null;
    }[];
  };
  /** Solo las habitaciones recotizadas, por `roomId` en `key`; `null` si el cambio no recotiza. */
  quotes: {
    rooms: {
      key: string;
      categoryRoom: string;
      nights: number;
      nightlyRates: { date: string; rate: Money }[];
      lodgingAmount: Money;
    }[];
    /** La suma de todas las habitaciones que quedarían, las conservadas y las cotizadas. */
    total: Money;
  } | null;
  reservation: { startDate: string; endDate: string; guestCount: number };
};

/** El cuerpo de la confirmación (B2): el de cambio más las tarifas que vio el solicitante. */
export type ModificationConfirmation = ModificationRequest & {
  expectedRates: { roomId: string; lodgingAmount: string; currency: string }[];
};

/**
 * `GET /api/reservations/{reservationRef}` (C3): la reserva que se va a modificar.
 * @throws ApiError `RESERVATION_NOT_FOUND` o `INVALID_RESERVATION_CODE`.
 */
export function getReservationToModify(
  reservationRef: string,
  signal?: AbortSignal,
): Promise<ReservationToModify> {
  return apiRequest<ReservationToModify>(
    `/reservations/${encodeURIComponent(reservationRef)}`,
    { signal },
  );
}

/**
 * `POST /api/reservations/{reservationRef}/modification-preview` (B1): valida, verifica la disponibilidad y
 * cotiza lo que corresponda, sin guardar nada.
 * @throws ApiError con el error de la tabla de B (por ejemplo `ROOM_NOT_AVAILABLE`).
 */
export function previewModification(
  reservationRef: string,
  body: ModificationRequest,
  signal?: AbortSignal,
): Promise<ModificationPreview> {
  return apiRequest<ModificationPreview>(
    `/reservations/${encodeURIComponent(reservationRef)}/modification-preview`,
    { method: 'POST', body, signal },
  );
}

/**
 * `PATCH /api/reservations/{reservationRef}` (B2): vuelve a validar y cotizar, compara con `expectedRates` y
 * guarda. Devuelve el detalle actualizado (C3), con el `updatedAt` nuevo.
 * @throws ApiError con el error de la tabla de B (por ejemplo `RATE_CHANGED` o `CONCURRENT_UPDATE`).
 */
export function confirmModification(
  reservationRef: string,
  body: ModificationConfirmation,
): Promise<ReservationDetail> {
  return apiRequest<ReservationDetail>(
    `/reservations/${encodeURIComponent(reservationRef)}`,
    { method: 'PATCH', body },
  );
}
