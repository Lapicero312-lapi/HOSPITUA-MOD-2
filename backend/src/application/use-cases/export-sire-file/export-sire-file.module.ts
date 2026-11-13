import { Module } from '@nestjs/common';
import { ProcessGuestDataModule } from '../process-guest-data/process-guest-data.module.js';
import { ExportSireFileService } from './export-sire-file.service.js';
import { ListSireMovementsService } from './list-sire-movements.service.js';
import { EXPORT_SIRE_FILE } from './ports/in/export-sire-file.port.js';
import { LIST_SIRE_MOVEMENTS } from './ports/in/list-sire-movements.port.js';
import { PREVIEW_SIRE_MOVEMENT } from './ports/in/preview-sire-movement.port.js';
import { PreviewSireMovementService } from './preview-sire-movement.service.js';

/**
 * Los servicios de `export-sire-file` (plan base, regla 4 de la arquitectura). Importa
 * `ProcessGuestDataModule` por `SELECT_FOREIGN_MOVEMENTS`, y usa `SIRE_EXPORT_REPOSITORY` de
 * `PersistenceModule`, `CLOCK` de `ClockModule` y `SIRE_CONFIG` de `SireConfigModule`, que son globales.
 */
@Module({
  imports: [ProcessGuestDataModule],
  providers: [
    { provide: EXPORT_SIRE_FILE, useClass: ExportSireFileService },
    { provide: LIST_SIRE_MOVEMENTS, useClass: ListSireMovementsService },
    { provide: PREVIEW_SIRE_MOVEMENT, useClass: PreviewSireMovementService },
  ],
  exports: [EXPORT_SIRE_FILE, LIST_SIRE_MOVEMENTS, PREVIEW_SIRE_MOVEMENT],
})
export class ExportSireFileModule {}
