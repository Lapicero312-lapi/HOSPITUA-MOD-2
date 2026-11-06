import type { MigratoryMovement } from '../../../domain/migration/migratory-movement.js';
import type { MovementType } from '../../../domain/shared/enums.js';
import type { Transaction } from './transaction.js';

/** Símbolo con el que Nest inyecta el repositorio (plan base, regla 4). */
export const MIGRATORY_MOVEMENT_REPOSITORY = Symbol(
  'MIGRATORY_MOVEMENT_REPOSITORY',
);

/**
 * Un movimiento con los datos de su huésped y la referencia de su reserva, tal como están guardados. Las
 * fechas son `AAAA-MM-DD`.
 */
export type MovementWithGuest = {
  movementId: string;
  reservationRef: string;
  movementType: MovementType;
  movementDate: string;
  guest: {
    firstName: string;
    lastName: string;
    documentType: string;
    documentNumber: string;
    birthDate: string;
    nationality: string;
    originPlace: string | null;
    destinationPlace: string | null;
  };
};

/**
 * Los movimientos migratorios (`process-guest-data`, T004): un `ENTRY` y un `DEPARTURE` por huésped y
 * reserva. Se escriben una vez y no se modifican ni se borran (plan, "Modelo de datos": escritura una vez
 * y lectura).
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

  /**
   * T012: los movimientos con `movementDate` entre `from` y `to` (`AAAA-MM-DD`, los dos incluidos), de
   * cualquier nacionalidad, con su huésped.
   */
  findWithGuestByPeriod(from: string, to: string): Promise<MovementWithGuest[]>;

  /** T012: el movimiento con ese id (UUID), con su huésped, o `null` si no existe. */
  findWithGuestById(movementId: string): Promise<MovementWithGuest | null>;
}
