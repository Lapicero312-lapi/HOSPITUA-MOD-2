import { Inject, Injectable } from '@nestjs/common';
import { formatSireLine } from '../../../domain/migration/sire-line.js';
import { BusinessError } from '../../../domain/shared/business-error.js';
import { SIRE_CONFIG, type SireConfig } from '../../ports/out/sire-config.js';
import {
  SELECT_FOREIGN_MOVEMENTS,
  type SelectForeignMovements,
} from '../process-guest-data/ports/in/select-foreign-movements.port.js';
import { MOVEMENT_NOT_FOUND } from './error-codes.js';
import type {
  PreviewSireMovement,
  SireMovementPreview,
} from './ports/in/preview-sire-movement.port.js';

/**
 * `PreviewSireMovement` (plan de `export-sire-file`, contrato C y D2): la línea de un movimiento con
 * `formatSireLine`, la misma función del archivo, para que coincidan exactamente. No registra nada.
 */
@Injectable()
export class PreviewSireMovementService implements PreviewSireMovement {
  constructor(
    @Inject(SELECT_FOREIGN_MOVEMENTS)
    private readonly selection: SelectForeignMovements,
    @Inject(SIRE_CONFIG)
    private readonly config: SireConfig,
  ) {}

  async execute(movementId: string): Promise<SireMovementPreview> {
    // `byMovementId` devuelve `null` sin consultar la base si el id no es un UUID.
    const movement = await this.selection.byMovementId(movementId);
    if (movement === null) {
      throw new BusinessError(
        MOVEMENT_NOT_FOUND.code,
        MOVEMENT_NOT_FOUND.message,
      );
    }
    const { fields, line } = formatSireLine(movement, this.config.format);
    return {
      movementId: movement.movementId,
      reservationRef: movement.reservationRef,
      fields,
      line,
    };
  }
}
