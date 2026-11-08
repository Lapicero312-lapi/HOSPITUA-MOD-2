import { Module } from '@nestjs/common';
import { ProcessGuestDataModule } from '../process-guest-data/process-guest-data.module.js';
import { ExportSireFileService } from './export-sire-file.service.js';
import { EXPORT_SIRE_FILE } from './ports/in/export-sire-file.port.js';

/**
 * Los servicios de `export-sire-file` (plan base, regla 4 de la arquitectura). Importa
 * `ProcessGuestDataModule` por `SELECT_FOREIGN_MOVEMENTS`, y usa `SIRE_EXPORT_REPOSITORY` de
 * `PersistenceModule`, `CLOCK` de `ClockModule` y `SIRE_CONFIG` de `SireConfigModule`, que son globales.
 */
@Module({
  imports: [ProcessGuestDataModule],
  providers: [{ provide: EXPORT_SIRE_FILE, useClass: ExportSireFileService }],
  exports: [EXPORT_SIRE_FILE],
})
export class ExportSireFileModule {}
