import type { Reservation } from '../../../../../domain/reservation/reservation.js';
import type { CancellationChannel } from '../../../../../domain/shared/enums.js';
import type { Transaction } from '../../../../ports/out/transaction.js';

/** Símbolo con el que Nest inyecta el servicio (plan base, regla 4). */
export const CANCEL_RESERVATION = Symbol('CANCEL_RESERVATION');

/** Lo que pide cancelar la Recepcionista (A) o Booking (B) (plan de `cancel-reservation`, B). */
export type CancelReservationCommand = {
  reservationRef: string;
  channel: CancellationChannel;
  /** `X-User` en A; `Booking.com` en B. */
  processedBy: string;
  reason: string | null;
  /** Obligatorio en A: la casilla "Entiendo que la cancelación no se puede deshacer" (FR-002b). */
  acknowledged?: boolean;
  /** Obligatorio en A: el `updatedAt` que la pantalla leyó de la reserva. */
  expectedUpdatedAt?: string;
};

/**
 * La baja de toda la reserva (plan de `cancel-reservation`, B y punto 10). La Recepcionista y Booking usan
 * el mismo servicio, dentro de la transacción `tx` de quien llama.
 */
export interface CancelReservation {
  /**
   * Hace las verificaciones de la regla 3 en orden; después pasa la reserva a `CANCELLED`, guarda su
   * `Cancellation` y anota el cambio en la lista del día, todo en `tx` (regla 4).
   * @returns La reserva ya cancelada, con su `updatedAt` nuevo.
   * @throws BusinessError con un código de la tabla C.
   */
  cancel(
    tx: Transaction,
    command: CancelReservationCommand,
  ): Promise<Reservation>;
}
