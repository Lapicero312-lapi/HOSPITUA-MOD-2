import type { ReservationDetail } from '../../../check-view-reservation/ports/in/get-reservation-detail.port.js';

/** Símbolo con el que Nest inyecta el servicio en `ReservationsController` (plan base, regla 4). */
export const CONFIRM_MODIFICATION = Symbol('CONFIRM_MODIFICATION');

/**
 * La confirmación de la modificación de una reserva directa (plan de `update-reservation`, B2, D2 y regla
 * 9; T010, T011 y T012): repite las validaciones de la vista previa, vuelve a cotizar y compara con lo que
 * vio el solicitante, y guarda en una transacción con el aviso a la lista del día.
 */
export interface ConfirmModification {
  /**
   * @param body El cuerpo de cambio con `expectedRates`, tal como llegó.
   * @returns El detalle de la reserva (C3 de `check-view-reservation`), leído después del `COMMIT`, con su
   * `updatedAt` nuevo.
   * @throws BusinessError con los códigos de la tabla de errores de B.
   */
  execute(reservationRef: string, body: unknown): Promise<ReservationDetail>;
}
