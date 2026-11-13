import type {
  RoomStayNotification,
  RoomStayOutcome,
} from './room-stay-notification.port.js';

/** Símbolo con el que Nest inyecta el servicio en `CheckOutConsumer` (plan base, regla 4). */
export const PROCESS_CHECK_OUT = Symbol('PROCESS_CHECK_OUT');

/** Una notificación de Check-Out: su `movementType` es siempre `DEPARTURE`. */
export type CheckOutNotification = RoomStayNotification;

/** `APPLIED`: la habitación pasó a `CHECKED_OUT`; `DUPLICATE`: el mismo mensaje o ya estaba `CHECKED_OUT`. */
export type CheckOutOutcome = RoomStayOutcome;

/** El Check-Out de una habitación (plan de `update-reservation`, "Check-Out (FR-017)" y D4). */
export interface ProcessCheckOut {
  /**
   * Aplica el Check-Out en una transacción, con las verificaciones en el orden del plan.
   * @throws Error ante un fallo temporal (la base de datos caída, por ejemplo): no se confirma nada y el
   * consumidor reintenta.
   */
  execute(notification: CheckOutNotification): Promise<CheckOutOutcome>;
}
