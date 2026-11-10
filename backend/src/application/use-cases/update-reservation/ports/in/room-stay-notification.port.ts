import type { GuestPayload } from '../../../process-guest-data/ports/in/register-guest-movements.port.js';

/**
 * Una notificación de Check-In o de Check-Out del Módulo 1, ya revisada por el consumidor (plan de
 * `update-reservation`, contrato A): una por habitación. El `movementType` lo da la cola: `ENTRY` en el
 * Check-In y `DEPARTURE` en el Check-Out.
 */
export type RoomStayNotification = {
  /** UUID que el Módulo 1 genera una sola vez por hecho y repite en los reintentos (FR-023). */
  messageId: string;
  /** Entero creciente por cola, que nunca se reinicia (FR-023). */
  sequenceNumber: number;
  /** La cola de la que llegó, para `processed_message`. */
  queue: string;
  reservationRef: string;
  roomId: string;
  /** `AAAA-MM-DD`: el `checkInDate` o el `checkOutDate`, que vale para todos los huéspedes de la lista. */
  movementDate: string;
  /** Todos los huéspedes de la habitación; los registra `process-guest-data`. */
  guests: GuestPayload[];
};

/**
 * Qué pasó con la notificación. En los tres casos el consumidor confirma el mensaje (plan base,
 * "Traducción de respuestas HTTP a cola"):
 * - `APPLIED`: la habitación cambió de estado y se registraron los huéspedes;
 * - `DUPLICATE`: el mismo `messageId`, o la habitación ya en el estado al que la llevaría (el "200
 *   idempotente");
 * - `REJECTED`: no se cambió nada y quedó en el log (el "400").
 */
export type RoomStayOutcome = 'APPLIED' | 'DUPLICATE' | 'REJECTED';
