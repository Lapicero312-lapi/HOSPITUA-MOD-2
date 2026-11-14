import type { Reservation } from '../../../../../domain/reservation/reservation.js';
import type { Transaction } from '../../../../ports/out/transaction.js';

/** Símbolo con el que Nest inyecta el servicio en `CloseDay` (`update-reservation`). */
export const OTA_NO_SHOW_REPORTER = Symbol('OTA_NO_SHOW_REPORTER');

/**
 * El reporte del no-show de una reserva de Booking (plan, regla 9 y punto 8; FR-011): el cierre del día lo
 * deja pendiente en su transacción y `PublishPendingNoShows` lo envía a Channex.
 */
export interface OtaNoShowReporter {
  /**
   * Deja `PENDING` el reporte de la reserva, en la transacción `tx` del `NO_SHOW`, con el `booking_id` de sus
   * revisiones. Si ya lo tenía, no hace nada.
   * @throws Error si la reserva no es `OTA` o no tiene ninguna revisión: es un dato que no debería existir.
   * Quien llama revierte su transacción.
   */
  record(tx: Transaction, reservation: Reservation): Promise<void>;
}
