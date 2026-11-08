import type { Reservation } from '../../../domain/reservation/reservation.js';
import type {
  ReservationSource,
  ReservationStatus,
} from '../../../domain/shared/enums.js';
import type { Transaction } from './transaction.js';

/** Símbolo con el que Nest inyecta el puerto (plan base, regla 4). */
export const RESERVATION_QUERY_PORT = Symbol('RESERVATION_QUERY_PORT');

/** Una habitación que ya ocupa inventario y la reserva que la ocupa (`check-room-availability`, A1). */
export type BlockingRoom = { roomId: string; reservationRef: string };

/** Tamaño fijo de una página del listado (`check-view-reservation`, C1: no hay `pageSize`). */
export const RESERVATION_PAGE_SIZE = 10;

/** Los filtros de C1 ya validados (`check-view-reservation`, "Consulta del listado", T005). */
export type ReservationListFilters = {
  /** `null`: todos los estados. */
  status: ReservationStatus | null;
  source: ReservationSource | null;
  /** Solo llega con `source = OTA` (lo valida T007). */
  otaId: string | null;
  /** `true`: solo las que tienen `conflict_reason` (FR-002a). */
  inConflict: boolean;
  /** Cruce con la estadía: `start_date <= dateTo` y `end_date > dateFrom`, en `AAAA-MM-DD`. */
  stayRange: { dateFrom: string; dateTo: string } | null;
  /** Por `start_date` y, si empatan, por `reservation_ref`, en el mismo sentido. */
  order: 'asc' | 'desc';
};

/** Una reserva de la página, con lo que hace falta para armar su fila (T010). */
export type ReservationListItem = {
  /** Con su titular y todas sus habitaciones. */
  reservation: Reservation;
  /** El nombre de la agencia en las reservas `OTA`; `null` en las directas. */
  otaName: string | null;
  /** Si tiene movimientos migratorios de huéspedes extranjeros, para `deriveMigrationStatus` (FR-005b). */
  hasForeignMovement: boolean;
};

export type ReservationListPage = {
  /** Con los mismos filtros, sin paginar. */
  totalItems: number;
  items: ReservationListItem[];
};

/**
 * Las consultas de solo lectura sobre las reservas (`check-view-reservation`, `ReservationQueryPort`).
 * Cada tarea agrega el método que le toca.
 */
export interface ReservationQueryPort {
  /**
   * Las habitaciones de `roomIds` que ya ocupan inventario en `[startDate, endDate)`, sin las de la
   * reserva `excludeReservationRef` (`check-room-availability`, A1). Una habitación bloquea si su reserva
   * está en `PENDING`, `ACTIVE` o `IN_PROGRESS` y ella en `EXPECTED` o `CHECKED_IN`: en la base es
   * `reservation_room.blocks_inventory` (D3).
   */
  findBlockingRooms(
    roomIds: string[],
    startDate: string,
    endDate: string,
    excludeReservationRef?: string,
  ): Promise<BlockingRoom[]>;

  /**
   * T005: una página de `RESERVATION_PAGE_SIZE` reservas con los filtros de C1, con `page` desde 1. Si
   * `page` pasa de la última, devuelve `items` vacío con el `totalItems` real: el ajuste a la última
   * página válida es de T011. La búsqueda por código, documento o nombre la agregan T015 y T020.
   * @throws Error si `page` no es un entero de 1 en adelante: es un error del programa (lo valida T007).
   */
  listReservations(
    filters: ReservationListFilters,
    page: number,
  ): Promise<ReservationListPage>;

  /**
   * T023: las reservas `ACTIVE` con `startDate` igual a `operationalDate` (`AAAA-MM-DD`), completas y con
   * el nombre de su agencia, ordenadas por `reservationRef`. Lee en `tx`, después del bloqueo de la fila
   * del día (`GenerateDailyList`, paso 2). Quién de ellas entra a la lista lo decide el dominio
   * (`DailyListMembership.belongs`).
   */
  findArrivals(
    operationalDate: string,
    tx: Transaction,
  ): Promise<DailyListArrival[]>;

  /**
   * T012: cuántas reservas se esperan ese día (C2, FR-005a), contadas por reserva y no por habitación.
   * `operationalDate` es `AAAA-MM-DD`.
   */
  countExpectedArrivalsAndDepartures(
    operationalDate: string,
  ): Promise<ExpectedArrivalsAndDepartures>;
}

/** Las dos cifras del resumen del día (C2). */
export type ExpectedArrivalsAndDepartures = {
  /** Reservas `ACTIVE` o `PENDING` con `startDate` igual al día. */
  expectedArrivals: number;
  /** Reservas `IN_PROGRESS` con `endDate` igual al día. */
  expectedDepartures: number;
};

/** Una llegada del día, con lo que hace falta para proyectarla en la lista (T023). */
export type DailyListArrival = {
  /** Con su titular y todas sus habitaciones. */
  reservation: Reservation;
  /** El nombre de la agencia en las reservas `OTA`; `null` en las directas. */
  otaName: string | null;
};
