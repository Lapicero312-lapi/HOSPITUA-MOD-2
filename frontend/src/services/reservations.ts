import { apiRequest } from './api-client.ts';

/** El estado de una reserva (plan base, "Estados de la reserva"). */
export type ReservationStatus =
  'PENDING' | 'ACTIVE' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';

/** El canal de una reserva: directa o de una agencia. */
export type ReservationSource = 'DIRECT' | 'OTA';

/** El estado migratorio que se muestra en cada fila (spec de `check-view-reservation`, FR-005b). */
export type MigrationStatus =
  'AWAITING_CHECK_IN' | 'COMPLETE' | 'NOT_REQUIRED' | 'NO_CHECK_IN';

/** Por qué una reserva de Booking está en conflicto (FR-002a). */
export type ReservationConflict = { reason: string; detectedAt: string };

/** Una fila del listado (plan de `check-view-reservation`, C1). Las fechas son `AAAA-MM-DD`. */
export type ReservationListItem = {
  reservationRef: string;
  /** Solo en reservas `OTA`. */
  externalConfirmationCode: string | null;
  guest: { fullName: string; documentNumber: string | null };
  /** Una habitación sin asignar trae `roomNumber` en `null`. */
  rooms: { roomNumber: string | null; categoryRoom: string }[];
  source: ReservationSource;
  /** Solo en reservas `OTA`. */
  otaName: string | null;
  startDate: string;
  endDate: string;
  status: ReservationStatus;
  migrationStatus: MigrationStatus;
  conflict: ReservationConflict | null;
  actions: { canModify: boolean; canCancel: boolean; canAssignRoom: boolean };
};

/** La respuesta de `GET /api/reservations` para la Recepcionista (C1). */
export type ReservationList = {
  items: ReservationListItem[];
  /** La página que se devolvió: si se pidió una que no existe, es la última válida. */
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  /** Solo sin resultados: "No se encontraron reservas con los filtros aplicados." */
  message: string | null;
};

/** Los filtros de C1. Lo que no se envía queda con el valor por defecto del backend. */
export type ReservationListFilters = {
  search?: string;
  status?: ReservationStatus;
  source?: ReservationSource;
  /** Solo con `source` igual a `OTA`. */
  otaId?: string;
  inConflict?: boolean;
  /** Las dos o ninguna, en `AAAA-MM-DD`. */
  dateFrom?: string;
  dateTo?: string;
  /** Solo las que llegan ese día (`startDate`), en `AAAA-MM-DD` (FR-003b). */
  arrivalDate?: string;
  order?: 'asc' | 'desc';
  page?: number;
};

/** El resumen del día operativo (C2), solo con datos del Módulo 2. */
export type DaySummary = {
  /** `AAAA-MM-DD`. */
  operationalDate: string;
  expectedArrivals: number;
  expectedDepartures: number;
};

/**
 * `GET /api/reservations` (C1): una página de 10 reservas con los filtros, el orden y la búsqueda.
 * @throws ApiError con el error que respondió el backend (los de la tabla de C1).
 */
export function listReservations(
  filters: ReservationListFilters,
  signal?: AbortSignal,
): Promise<ReservationList> {
  const query = new URLSearchParams();
  const add = (name: string, value: string | undefined) => {
    if (value !== undefined && value !== '') {
      query.set(name, value);
    }
  };
  add('search', filters.search);
  add('status', filters.status);
  add('source', filters.source);
  add('otaId', filters.otaId);
  // El backend solo admite `inConflict=true`.
  add('inConflict', filters.inConflict === true ? 'true' : undefined);
  add('dateFrom', filters.dateFrom);
  add('dateTo', filters.dateTo);
  add('arrivalDate', filters.arrivalDate);
  add('order', filters.order);
  add('page', filters.page === undefined ? undefined : String(filters.page));
  const text = query.toString();
  return apiRequest<ReservationList>(
    text === '' ? '/reservations' : `/reservations?${text}`,
    { signal },
  );
}

/**
 * `GET /api/reservations/day-summary` (C2): las llegadas y salidas esperadas del día operativo.
 * @throws ApiError con el error que respondió el backend.
 */
export function getDaySummary(signal?: AbortSignal): Promise<DaySummary> {
  return apiRequest<DaySummary>('/reservations/day-summary', { signal });
}
