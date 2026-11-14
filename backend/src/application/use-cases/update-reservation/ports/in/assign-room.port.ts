import type { ReservationDetail } from '../../../check-view-reservation/ports/in/get-reservation-detail.port.js';

/** Símbolo con el que Nest inyecta el servicio en `ReservationsController` (plan base, regla 4). */
export const ASSIGN_ROOM = Symbol('ASSIGN_ROOM');

/**
 * La asignación de habitación a una reserva de Booking en conflicto (plan de `update-reservation`, B3 y
 * punto 16; FR-025; T027). Es lo único que la Recepcionista puede cambiar de una reserva de Booking.
 */
export interface AssignRoom {
  /**
   * @param body `{ updatedAt, assignments: [{ reservationRoomId, roomId }] }`, tal como llegó.
   * @returns El detalle de la reserva (C3 de `check-view-reservation`), leído después del `COMMIT`.
   * @throws BusinessError con los códigos de la tabla de B3 y los de la forma (punto 16).
   */
  execute(reservationRef: string, body: unknown): Promise<ReservationDetail>;
}
