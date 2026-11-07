import type {
  ConflictReason,
  MigrationStatus,
  ReservationSource,
  ReservationStatus,
} from '../../../../../domain/shared/enums.js';
import type { ReservationListFilters } from '../../../../ports/out/reservation-query.port.js';

/** Símbolo con el que Nest inyecta el caso de uso (plan base, regla 4). */
export const LIST_RESERVATIONS = Symbol('LIST_RESERVATIONS');

/** El mensaje de un listado sin resultados (C1, FR-010). */
export const NO_RESERVATIONS_MESSAGE =
  'No se encontraron reservas con los filtros aplicados.';

/**
 * Una fila del listado de la Recepcionista (plan de `check-view-reservation`, C1): una reserva por fila,
 * con todas sus habitaciones. Nunca trae datos financieros (FR-015).
 */
export type ReservationListRow = {
  reservationRef: string;
  /** Solo en reservas `OTA`. */
  externalConfirmationCode: string | null;
  guest: { fullName: string; documentNumber: string | null };
  /** Una habitación sin asignar va con `roomNumber` en `null` ("Sin asignar"). */
  rooms: { roomNumber: string | null; categoryRoom: string }[];
  source: ReservationSource;
  /** Solo en reservas `OTA`. */
  otaName: string | null;
  startDate: string;
  endDate: string;
  status: ReservationStatus;
  migrationStatus: MigrationStatus;
  /** Solo en una reserva de Booking en conflicto (FR-002a). */
  conflict: { reason: ConflictReason; detectedAt: Date } | null;
  actions: { canModify: boolean; canCancel: boolean; canAssignRoom: boolean };
};

/** Una página del listado (C1, "Respuesta 200"). */
export type ReservationListResult = {
  items: ReservationListRow[];
  /** La página que se devolvió: la última válida si la pedida pasaba de la última (T011). */
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  /** `NO_RESERVATIONS_MESSAGE` si no hay resultados; si no, `null`. */
  message: string | null;
};

/** El listado de reservas de la Recepcionista (C1, T009), con los filtros ya validados (T007). */
export interface ListReservations {
  execute(
    filters: ReservationListFilters,
    page: number,
  ): Promise<ReservationListResult>;
}
