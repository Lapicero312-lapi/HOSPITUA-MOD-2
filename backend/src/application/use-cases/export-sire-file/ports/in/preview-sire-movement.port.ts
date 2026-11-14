import type { SireField } from '../../../../../domain/migration/sire-line.js';

/** Símbolo con el que Nest inyecta el servicio en `SireController` (plan base, regla 4). */
export const PREVIEW_SIRE_MOVEMENT = Symbol('PREVIEW_SIRE_MOVEMENT');

/** La línea de un movimiento tal como saldría en el archivo (plan de `export-sire-file`, contrato C). */
export type SireMovementPreview = {
  movementId: string;
  reservationRef: string;
  /** Los 12 campos, en orden, con su posición, su nombre y su valor. */
  fields: SireField[];
  /** La línea, sin el fin de línea. */
  line: string;
};

/** La vista previa de un movimiento (plan, contrato C y D2). Solo lee: no crea una `SireExport`. */
export interface PreviewSireMovement {
  /**
   * @throws BusinessError `MOVEMENT_NOT_FOUND` si el movimiento no existe, es de un colombiano o el id no
   * es un UUID, o `INVALID_GUEST_CHARACTERS` si un dato del huésped no se puede escribir en el archivo.
   */
  execute(movementId: string): Promise<SireMovementPreview>;
}
