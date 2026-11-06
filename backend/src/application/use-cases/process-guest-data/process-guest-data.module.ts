import { Module } from '@nestjs/common';
import { SELECT_FOREIGN_MOVEMENTS } from './ports/in/select-foreign-movements.port.js';
import { SelectForeignMovementsService } from './select-foreign-movements.service.js';

/**
 * Los servicios de `process-guest-data` (plan base, regla 4 de la arquitectura). Usa
 * `MIGRATORY_MOVEMENT_REPOSITORY` de `PersistenceModule`, que es global.
 */
@Module({
  providers: [
    {
      provide: SELECT_FOREIGN_MOVEMENTS,
      useClass: SelectForeignMovementsService,
    },
  ],
  exports: [SELECT_FOREIGN_MOVEMENTS],
})
export class ProcessGuestDataModule {}
