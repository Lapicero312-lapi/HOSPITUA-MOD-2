import { apiRequest } from './api-client.ts';

export type NationalityFilter = 'ALL' | 'FOREIGN' | 'COLOMBIAN';
export type PresenceFilter = 'ALL' | 'IN_HOTEL' | 'CHECKED_OUT';
export type MovementType = 'ENTRY' | 'DEPARTURE';

/** Una fila de `GET /api/guest-stays` (plan de `process-guest-data`, C1): un huésped en una reserva. */
export type GuestStay = {
  reservationRef: string;
  guest: {
    firstName: string;
    lastName: string;
    documentType: string;
    documentNumber: string;
    nationality: string;
    /** Nacionalidad distinta de `Colombia`. */
    isForeign: boolean;
  };
  /** `AAAA-MM-DD`; `null` si solo tiene salida. */
  entryDate: string | null;
  /** `AAAA-MM-DD`; `null` si todavía no salió. */
  exitDate: string | null;
  /** `true` sin salida: la pantalla muestra "En el hotel". */
  inHotel: boolean;
};

/** La respuesta de C1. */
export type GuestStayPage = {
  items: GuestStay[];
  /** La página devuelta: si se pidió una que no existe, la última válida. */
  page: number;
  pageSize: number;
  totalItems: number;
  /** `0` sin resultados. */
  totalPages: number;
  /** Sin resultados: "No hay huéspedes que coincidan con los filtros."; si no, `null`. */
  message: string | null;
};

/** Los filtros de C1. Lo que no viene toma el valor por defecto del backend. */
export type GuestStayFilters = {
  nationality?: NationalityFilter;
  presence?: PresenceFilter;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  page?: number;
};

/** La respuesta de `GET /api/reservations/{reservationRef}/guests/{documentNumber}` (C2). */
export type GuestStayDetail = {
  reservationRef: string;
  /** La ruta de la API del detalle de la reserva. */
  reservationLink: string;
  guest: {
    documentType: string;
    documentNumber: string;
    /** Lo vacío viaja `null`: la pantalla muestra una raya "—". */
    firstName: string | null;
    lastName: string | null;
    /** `AAAA-MM-DD`. */
    birthDate: string;
    nationality: string | null;
    isForeign: boolean;
    originPlace: string | null;
    destinationPlace: string | null;
  };
  /** Ordenados por fecha; puede traer solo la entrada o solo la salida. */
  movements: { movementType: MovementType; movementDate: string }[];
};

/**
 * `GET /api/guest-stays` (C1): los huéspedes alojados, de 10 en 10. Solo envía los filtros indicados: el
 * backend los revisa y, si alguno no es válido, responde 400 con su mensaje.
 * @throws ApiError con el error de la tabla de C1.
 */
export function listGuestStays(
  filters: GuestStayFilters,
  signal?: AbortSignal,
): Promise<GuestStayPage> {
  const params = new URLSearchParams();
  if (filters.nationality !== undefined) {
    params.set('nationality', filters.nationality);
  }
  if (filters.presence !== undefined) {
    params.set('presence', filters.presence);
  }
  if (filters.dateFrom !== undefined) params.set('dateFrom', filters.dateFrom);
  if (filters.dateTo !== undefined) params.set('dateTo', filters.dateTo);
  if (filters.search !== undefined) params.set('search', filters.search);
  if (filters.page !== undefined) params.set('page', String(filters.page));
  const query = params.toString();
  return apiRequest<GuestStayPage>(
    query === '' ? '/guest-stays' : `/guest-stays?${query}`,
    { signal },
  );
}

/**
 * `GET /api/reservations/{reservationRef}/guests/{documentNumber}` (C2): el detalle de un huésped en una
 * reserva.
 * @throws ApiError `GUEST_NOT_FOUND`, `INVALID_RESERVATION_CODE` o `INVALID_DOCUMENT_NUMBER`.
 */
export function getGuestStayDetail(
  reservationRef: string,
  documentNumber: string,
  signal?: AbortSignal,
): Promise<GuestStayDetail> {
  return apiRequest<GuestStayDetail>(
    `/reservations/${encodeURIComponent(reservationRef)}/guests/${encodeURIComponent(documentNumber)}`,
    { signal },
  );
}
