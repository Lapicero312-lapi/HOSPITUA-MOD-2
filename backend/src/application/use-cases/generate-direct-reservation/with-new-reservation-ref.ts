import { newReservationRef } from '../../../domain/reservation/reservation-ref.js';
import { DuplicateReservationRefError } from '../../ports/out/reservation.repository.js';

/** Intentos con una referencia distinta antes de rendirse (plan de `generate-direct-reservation`, regla 7). */
export const MAX_REFERENCE_ATTEMPTS = 5;

/**
 * Guarda con una referencia nueva y, si ya existe (`DuplicateReservationRefError`), prueba con otra,
 * hasta 5 intentos (plan, regla 7: "si ya existe, se genera otra"). Si los 5 chocan, sale el último
 * error; cualquier otro error sale enseguida, sin reintentar.
 *
 * Cada intento (`save`) debe ser una transacción completa: después de un error de unicidad, PostgreSQL
 * deja abortada la transacción en la que ocurrió, así que no se puede reintentar dentro de ella.
 */
export async function withNewReservationRef<T>(
  save: (reservationRef: string) => Promise<T>,
  generate: () => string = newReservationRef,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await save(generate());
    } catch (error) {
      if (
        !(error instanceof DuplicateReservationRefError) ||
        attempt >= MAX_REFERENCE_ATTEMPTS
      ) {
        throw error;
      }
    }
  }
}
