import type { GuestPayload } from '../../../process-guest-data/ports/in/register-guest-movements.port.js';

/** Símbolo con el que Nest inyecta el servicio en `CheckInConsumer` (plan base, regla 4). */
export const PROCESS_CHECK_IN = Symbol('PROCESS_CHECK_IN');

/**
 * Una notificación de Check-In del Módulo 1 ya revisada por el consumidor (plan de `update-reservation`,
 * contrato A): una por habitación. El `movementType` es siempre `ENTRY`.
 */
export type CheckInNotification = {
  /** UUID que el Módulo 1 genera una sola vez por hecho y repite en los reintentos (FR-023). */
  messageId: string;
  /** Entero creciente por cola, que nunca se reinicia (FR-023). */
  sequenceNumber: number;
  /** La cola de la que llegó, para `processed_message`. */
  queue: string;
  reservationRef: string;
  roomId: string;
  /** `AAAA-MM-DD`: el `checkInDate`, que vale para todos los huéspedes de la lista. */
  movementDate: string;
  /** Todos los huéspedes de la habitación; los registra `process-guest-data`. */
  guests: GuestPayload[];
};

/**
 * Qué pasó con la notificación. En los tres casos el consumidor confirma el mensaje (plan base,
 * "Traducción de respuestas HTTP a cola"):
 * - `APPLIED`: la habitación pasó a `CHECKED_IN` y se registraron los huéspedes;
 * - `DUPLICATE`: el mismo `messageId` o la habitación ya en `CHECKED_IN` (el "200 idempotente");
 * - `REJECTED`: no se cambió nada y quedó en el log (el "400").
 */
export type CheckInOutcome = 'APPLIED' | 'DUPLICATE' | 'REJECTED';

/** El Check-In de una habitación (plan de `update-reservation`, "Check-In (FR-015)" y D3). */
export interface ProcessCheckIn {
  /**
   * Aplica el Check-In en una transacción, con las verificaciones en el orden del plan.
   * @throws Error ante un fallo temporal (la base de datos caída, por ejemplo): no se confirma nada y el
   * consumidor reintenta.
   */
  execute(notification: CheckInNotification): Promise<CheckInOutcome>;
}
