import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { SireExport } from '../../../domain/migration/sire-export.js';
import { formatSireLine } from '../../../domain/migration/sire-line.js';
import { BusinessError } from '../../../domain/shared/business-error.js';
import { CLOCK, type Clock } from '../../ports/out/clock.js';
import { SIRE_CONFIG, type SireConfig } from '../../ports/out/sire-config.js';
import {
  SIRE_EXPORT_REPOSITORY,
  type SireExportRepository,
} from '../../ports/out/sire-export.repository.js';
import {
  SELECT_FOREIGN_MOVEMENTS,
  type SelectForeignMovements,
  type SireMovement,
} from '../process-guest-data/ports/in/select-foreign-movements.port.js';
import {
  MOVEMENT_NOT_FOUND,
  NO_MIGRATORY_MOVEMENTS,
  PERIOD_TOO_LARGE,
} from './error-codes.js';
import type {
  ExportSireFile,
  SireExportRequest,
  SireFile,
} from './ports/in/export-sire-file.port.js';

/**
 * `ExportSireFile` (plan de `export-sire-file`, contrato A, reglas 1 a 9, D1 y D2):
 * 1. Toma los movimientos de `SelectForeignMovements`, que ya deja solo a los extranjeros y los ordena
 *    (reglas 1 y 6): los del periodo, o el movimiento pedido.
 * 2. Sin movimientos en el periodo, `NO_MIGRATORY_MOVEMENTS`; con más de `SIRE_MAX_RECORDS`,
 *    `PERIOD_TOO_LARGE`; el movimiento que no está (o es de un colombiano), `MOVEMENT_NOT_FOUND`.
 * 3. Arma el archivo completo en memoria con `formatSireLine`, una línea por movimiento, cada una con su
 *    fin de línea (regla 3).
 * 4. Solo si salió entero registra la `SireExport` (reglas 7 y 8): si algo falla antes, no queda registro.
 *
 * No marca los movimientos (regla 5): cada descarga es una `SireExport` nueva.
 */
@Injectable()
export class ExportSireFileService implements ExportSireFile {
  constructor(
    @Inject(SELECT_FOREIGN_MOVEMENTS)
    private readonly selection: SelectForeignMovements,
    @Inject(SIRE_EXPORT_REPOSITORY)
    private readonly exports: SireExportRepository,
    @Inject(SIRE_CONFIG)
    private readonly config: SireConfig,
    @Inject(CLOCK)
    private readonly clock: Clock,
  ) {}

  async execute(
    request: SireExportRequest,
    processedBy: string,
  ): Promise<SireFile> {
    const movements = await this.movementsOf(request);
    const content = movements
      .map(
        (movement) =>
          formatSireLine(movement, this.config.format).line +
          this.config.lineBreak,
      )
      .join('');
    const saved = await this.exports.insert(
      SireExport.restore({
        id: randomUUID(),
        exportDate: this.clock.now(),
        exportKind: request.exportKind,
        recordsCount: movements.length,
        dateRangeStart:
          request.exportKind === 'PERIOD' ? request.startDate : null,
        dateRangeEnd: request.exportKind === 'PERIOD' ? request.endDate : null,
        processedBy,
      }),
    );
    return {
      exportId: saved.id,
      fileName: `SIRE_${saved.id}.txt`,
      content,
      recordsCount: saved.recordsCount,
    };
  }

  /** Los movimientos del archivo, ya revisados: al menos uno y no más de `SIRE_MAX_RECORDS`. */
  private async movementsOf(
    request: SireExportRequest,
  ): Promise<SireMovement[]> {
    if (request.exportKind === 'SINGLE_MOVEMENT') {
      const movement = await this.selection.byMovementId(request.movementId);
      if (movement === null) {
        throw new BusinessError(
          MOVEMENT_NOT_FOUND.code,
          MOVEMENT_NOT_FOUND.message,
        );
      }
      return [movement];
    }
    const movements = await this.selection.byPeriod(
      request.startDate,
      request.endDate,
    );
    if (movements.length === 0) {
      throw new BusinessError(
        NO_MIGRATORY_MOVEMENTS.code,
        NO_MIGRATORY_MOVEMENTS.message,
      );
    }
    if (movements.length > this.config.maxRecords) {
      throw new BusinessError(PERIOD_TOO_LARGE.code, PERIOD_TOO_LARGE.message);
    }
    return movements;
  }
}
