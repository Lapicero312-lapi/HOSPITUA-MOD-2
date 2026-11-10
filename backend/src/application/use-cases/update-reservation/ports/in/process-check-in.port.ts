import type {
  RoomStayNotification,
  RoomStayOutcome,
} from './room-stay-notification.port.js';

/** Símbolo con el que Nest inyecta el servicio en `CheckInConsumer` (plan base, regla 4). */
export const PROCESS_CHECK_IN = Symbol('PROCESS_CHECK_IN');

/** Una notificación de Check-In: su `movementType` es siempre `ENTRY`. */
export type CheckInNotification = RoomStayNotification;

/** `APPLIED`: la habitación pasó a `CHECKED_IN`; `DUPLICATE`: el mismo mensaje o ya estaba `CHECKED_IN`. */
export type CheckInOutcome = RoomStayOutcome;

/** El Check-In de una habitación (plan de `update-reservation`, "Check-In (FR-015)" y D3). */
export interface ProcessCheckIn {
  /**
   * Aplica el Check-In en una transacción, con las verificaciones en el orden del plan.
   * @throws Error ante un fallo temporal (la base de datos caída, por ejemplo): no se confirma nada y el
   * consumidor reintenta.
   */
  execute(notification: CheckInNotification): Promise<CheckInOutcome>;
}
