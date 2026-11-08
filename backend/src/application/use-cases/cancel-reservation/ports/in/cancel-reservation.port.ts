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

/** La respuesta 200 de la cancelación de la Recepcionista (plan, contrato A). */
export type CancellationResult = {
  reservationRef: string;
  status: 'CANCELLED';
  cancellation: {
    cancellationId: string;
    /** En hora de Colombia, con segundos: `2026-10-09T10:15:20-05:00`. */
    cancellationDate: string;
    channel: CancellationChannel;
    reason: string | null;
    processedBy: string;
    status: 'COMPLETED';
  };
};

/**
 * La baja de toda la reserva (plan de `cancel-reservation`, B y punto 10). La Recepcionista y Booking usan
 * el mismo servicio: Booking con `cancel`, dentro de la transacción de `generate-ota-reservation`, y la
 * Recepcionista con `execute`, que abre la suya (D1).
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

  /**
   * La cancelación de la Recepcionista (A, D1): lo mismo que `cancel`, en su propia transacción.
   * Devuelve la respuesta del contrato A, con la `Cancellation` que registró.
   * @throws BusinessError con un código de la tabla C; si falla, no queda nada a medias (regla 4).
   */
  execute(command: CancelReservationCommand): Promise<CancellationResult>;
}
