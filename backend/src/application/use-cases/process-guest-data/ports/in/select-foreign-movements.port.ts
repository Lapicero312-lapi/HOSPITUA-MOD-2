import type { MovementType } from '../../../../../domain/shared/enums.js';

/** Símbolo con el que Nest inyecta el servicio en `export-sire-file` (plan base, regla 4). */
export const SELECT_FOREIGN_MOVEMENTS = Symbol('SELECT_FOREIGN_MOVEMENTS');

/**
 * Un movimiento de un huésped extranjero con todos los datos que pide el archivo SIRE (plan, B2). Las
 * fechas son `AAAA-MM-DD`. Los datos salen tal como se guardaron: sin modificar ni completar (SC-002).
 */
export type SireMovement = {
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
 * La selección de los movimientos de extranjeros para el SIRE (plan de `process-guest-data`, B2). La usa
 * `export-sire-file`. Solo lee: los movimientos de los colombianos se conservan, pero no se entregan.
 */
export interface SelectForeignMovements {
  /**
   * FR-008: los movimientos de extranjeros con `movementDate` entre `from` y `to` (`AAAA-MM-DD`, los dos
   * incluidos), por `movementDate`, `reservationRef`, `documentNumber` y `movementType` (`ENTRY` antes que
   * `DEPARTURE`). `[]` si no hay ninguno.
   */
  byPeriod(from: string, to: string): Promise<SireMovement[]>;

  /**
   * La descarga individual: el movimiento con ese id, o `null` si no existe, es de un colombiano o el id no
   * es un UUID.
   */
  byMovementId(movementId: string): Promise<SireMovement | null>;
}
