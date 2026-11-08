import type { Cancellation } from '../../../../../domain/cancellation/cancellation.js';
import type { Reservation } from '../../../../../domain/reservation/reservation.js';

/** Símbolo con el que Nest inyecta el servicio (plan base, regla 4). */
export const GET_RESERVATION_DETAIL = Symbol('GET_RESERVATION_DETAIL');

/** El detalle de una reserva para la Recepcionista (plan de `check-view-reservation`, C3). */
export type ReservationDetail = {
  /** Completa: con sus habitaciones, su titular y su conflicto. */
  reservation: Reservation;
  /** Las noches entre `startDate` y `endDate`. */
  nights: number;
  /** El nombre de la agencia en las reservas `OTA`; `null` en las directas. */
  otaName: string | null;
  /** Solo en las reservas `CANCELLED`; el No-Show no tiene `Cancellation`. */
  cancellation: Cancellation | null;
};

/**
 * El detalle completo de una reserva (FR-006; plan de `check-view-reservation`, C3 y "`GetReservationDetail`").
 */
export interface GetReservationDetail {
  /**
   * @throws BusinessError `INVALID_RESERVATION_CODE` si `reservationRef` no es `RSV-` y 8 hexadecimales en
   * mayúscula (sin consultar la base, T017), o `RESERVATION_NOT_FOUND` si no existe.
   */
  execute(reservationRef: string): Promise<ReservationDetail>;
}
