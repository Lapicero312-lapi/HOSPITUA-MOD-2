import type { MigratoryMovement } from '../../../domain/migration/migratory-movement.js';
import type { Transaction } from './transaction.js';

/** Símbolo con el que Nest inyecta el repositorio (plan base, regla 4). */
export const MIGRATORY_MOVEMENT_REPOSITORY = Symbol(
  'MIGRATORY_MOVEMENT_REPOSITORY',
);

/**
 * Los movimientos migratorios (`process-guest-data`, T004): un `ENTRY` y un `DEPARTURE` por huésped y
 * reserva. Se escriben una vez y no se modifican ni se borran (plan, "Modelo de datos").
 */
export interface MigratoryMovementRepository {
  /**
   * Paso 5 de `register`: guarda en una sola sentencia
   * `INSERT INTO migratory_movement … ON CONFLICT (guest_data_id, movement_type) DO NOTHING`, dentro de la
   * transacción de quien llama. Un movimiento que ya existe no se duplica ni se modifica (FR-005).
   * @returns Cuántos movimientos se crearon; los demás ya estaban (`registered` y `alreadyRegistered` del
   * `RegistrationSummary`). Con una lista vacía no consulta la base.
   */
  insertMissing(
    movements: MigratoryMovement[],
    tx: Transaction,
  ): Promise<number>;
}
