import type { ReservationDetail } from '../../../check-view-reservation/ports/in/get-reservation-detail.port.js';

/** Símbolo con el que Nest inyecta el servicio en el controlador de la reserva directa. */
export const CREATE_DIRECT_RESERVATION = Symbol('CREATE_DIRECT_RESERVATION');

/**
 * Crea una reserva directa (plan de `generate-direct-reservation`, B, D2 y punto 12; T008): vuelve a
 * verificar la disponibilidad y a cotizar, compara con lo que vio el solicitante y la guarda en `ACTIVE`.
 */
export interface CreateDirectReservation {
  /**
   * @returns El detalle de la reserva creada, con la forma de C3 de `check-view-reservation`.
   * @throws BusinessError con los códigos de la tabla C.
   */
  execute(body: unknown): Promise<ReservationDetail>;
}
