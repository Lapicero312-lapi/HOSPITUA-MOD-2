import type { GuestData } from '../../../domain/migration/guest-data.js';
import type { Transaction } from './transaction.js';

/** Símbolo con el que Nest inyecta el repositorio (plan base, regla 4). */
export const GUEST_DATA_REPOSITORY = Symbol('GUEST_DATA_REPOSITORY');

/**
 * Los datos de los huéspedes de cada reserva (`process-guest-data`, T004). Se escriben una vez y no se
 * modifican ni se borran (plan, "Modelo de datos").
 */
export interface GuestDataRepository {
  /**
   * Paso 4 de `register`: guarda en una sola sentencia
   * `INSERT INTO guest_data … ON CONFLICT (reservation_id, document_number) DO NOTHING`, dentro de la
   * transacción de quien llama. Un huésped que ya existe en esa reserva no se modifica (FR-017).
   * @returns El `GuestData` guardado de cada huésped, en el mismo orden: el nuevo o el que ya estaba, sin
   * cambios. Con una lista vacía no consulta la base.
   * @throws Error si una reserva no existe: quien llama ya la localizó.
   */
  insertMissing(guests: GuestData[], tx: Transaction): Promise<GuestData[]>;
}
