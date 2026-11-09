import type {
  DocumentType,
  MovementType,
} from '../../../../../domain/shared/enums.js';

/** Símbolo con el que Nest inyecta el servicio en el controlador de la vista (plan base, regla 4). */
export const GET_GUEST_STAY_DETAIL = Symbol('GET_GUEST_STAY_DETAIL');

/**
 * El detalle de un huésped en una reserva (plan de `process-guest-data`, C2). Las fechas son `AAAA-MM-DD`.
 * "Lo vacío … viaja `null`" en cualquier dato que pueda llegar vacío; la pantalla muestra una raya "—"
 * (historia 3, escenario 6).
 */
export type GuestStayDetail = {
  reservationRef: string;
  /** El detalle de la reserva en "Consultar y buscar reservas" (FR-014). */
  reservationLink: string;
  guest: {
    documentType: DocumentType;
    documentNumber: string;
    /** `null` si está vacío. */
    firstName: string | null;
    /** `null` si está vacío. */
    lastName: string | null;
    birthDate: string;
    /** `null` si está vacía (el spec lo contempla en sus casos borde). */
    nationality: string | null;
    /** Nacionalidad distinta de `Colombia` y no vacía (punto 8), con la guardada. */
    isForeign: boolean;
    /** `null` si está vacío: la pantalla muestra una raya. */
    originPlace: string | null;
    /** `null` si está vacío: la pantalla muestra una raya. */
    destinationPlace: string | null;
  };
  /** Por fecha; puede traer solo la entrada o solo la salida. */
  movements: { movementType: MovementType; movementDate: string }[];
};

/** El detalle de un huésped de la vista de huéspedes alojados (plan, C2). Solo lee. */
export interface GetGuestStayDetail {
  /**
   * La `reservationRef` y el `documentNumber` ya los revisó `readGuestStayKey`.
   * @throws BusinessError `GUEST_NOT_FOUND` si el huésped o la reserva no existen, o si no tiene
   * movimientos.
   */
  execute(
    reservationRef: string,
    documentNumber: string,
  ): Promise<GuestStayDetail>;
}
