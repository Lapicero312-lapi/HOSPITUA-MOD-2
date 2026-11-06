import type { Cancellation } from '../../../domain/cancellation/cancellation.js';
import type { Transaction } from './transaction.js';

/** Símbolo con el que Nest inyecta el repositorio (plan base, regla 4). */
export const CANCELLATION_REPOSITORY = Symbol('CANCELLATION_REPOSITORY');

/**
 * Los registros de cancelación (`cancel-reservation`, D y T001). Cada uno es inmutable y hay uno solo por
 * reserva: la restricción única `uq_cancellation_reservation` de la migración base es el respaldo ante
 * dos cancelaciones simultáneas (regla 5).
 */
export interface CancellationRepository {
  /**
   * Guarda la `Cancellation` en la transacción de la cancelación (regla 4): si esa transacción se revierte,
   * no queda.
   * @throws DuplicateCancellationError si la reserva ya tiene su `Cancellation`.
   * @throws Error si la reserva no existe: quien cancela ya la localizó con bloqueo.
   */
  insert(cancellation: Cancellation, tx: Transaction): Promise<void>;
}

/** La reserva ya tiene su `Cancellation` (restricción única de `cancellation.reservation_id`). */
export class DuplicateCancellationError extends Error {
  constructor(readonly reservationRef: string) {
    super(`La reserva ${reservationRef} ya tiene su cancelación registrada.`);
  }
}
