import type { DocumentType } from '../../../domain/shared/enums.js';

/** Símbolo con el que Nest inyecta la consulta (plan base, regla 4). */
export const GUEST_STAY_QUERY = Symbol('GUEST_STAY_QUERY');

/**
 * Los filtros de la vista de huéspedes alojados, ya revisados (plan de `process-guest-data`, C1). Se
 * combinan con la regla "Y" (FR-013).
 */
export type GuestStayCriteria = {
  /** `FOREIGN`: nacionalidad distinta de `Colombia` y no vacía (punto 8); `COLOMBIAN`: `Colombia`. */
  nationality: 'ALL' | 'FOREIGN' | 'COLOMBIAN';
  /** `IN_HOTEL`: con entrada y sin salida; `CHECKED_OUT`: con salida. */
  presence: 'ALL' | 'IN_HOTEL' | 'CHECKED_OUT';
  /**
   * La estadía, de su entrada a su salida, se cruza con el rango (`AAAA-MM-DD`, los dos incluidos). Sin
   * salida, la estadía queda abierta hasta `today`; sin entrada, empieza en su salida (punto 5).
   */
  dateRange: { dateFrom: string; dateTo: string } | null;
  /** Documento exacto, o nombre o apellido parcial sin distinguir mayúsculas ni tildes. */
  search:
    | { kind: 'DOCUMENT'; documentNumber: string }
    | { kind: 'NAME'; text: string }
    | null;
  /** El día operativo (`AAAA-MM-DD`), para la estadía que todavía no tiene salida. */
  today: string;
};

/** Un huésped en una reserva, con la fecha de su entrada y la de su salida (`null` si no la tiene). */
export type GuestStayRow = {
  reservationRef: string;
  firstName: string;
  lastName: string;
  documentType: DocumentType;
  documentNumber: string;
  nationality: string;
  entryDate: string | null;
  exitDate: string | null;
};

/**
 * La consulta de la vista de huéspedes alojados (`process-guest-data`, "Consulta de la vista"). Solo lee.
 * Solo cuenta a los huéspedes con al menos un movimiento (FR-016).
 */
export interface GuestStayQuery {
  /** Cuántas filas cumplen los filtros. */
  count(criteria: GuestStayCriteria): Promise<number>;

  /**
   * Una página: por `entryDate` de la más reciente a la más antigua (sin entrada, por su `exitDate`),
   * luego por `reservationRef` y `documentNumber`.
   */
  findPage(
    criteria: GuestStayCriteria,
    offset: number,
    limit: number,
  ): Promise<GuestStayRow[]>;
}
