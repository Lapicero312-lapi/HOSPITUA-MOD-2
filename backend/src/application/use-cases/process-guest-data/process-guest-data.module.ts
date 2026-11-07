import { Module } from '@nestjs/common';
import { ListGuestStaysService } from './list-guest-stays.service.js';
import { LIST_GUEST_STAYS } from './ports/in/list-guest-stays.port.js';
import { SELECT_FOREIGN_MOVEMENTS } from './ports/in/select-foreign-movements.port.js';
import { SelectForeignMovementsService } from './select-foreign-movements.service.js';

/**
 * Los servicios de `process-guest-data` (plan base, regla 4 de la arquitectura). Usa
 * `MIGRATORY_MOVEMENT_REPOSITORY` y `GUEST_STAY_QUERY` de `PersistenceModule` y `CLOCK` de `ClockModule`,
 * que son globales.
 */
@Module({
  providers: [
    {
      provide: SELECT_FOREIGN_MOVEMENTS,
      useClass: SelectForeignMovementsService,
    },
    { provide: LIST_GUEST_STAYS, useClass: ListGuestStaysService },
  ],
  exports: [SELECT_FOREIGN_MOVEMENTS, LIST_GUEST_STAYS],
})
export class ProcessGuestDataModule {}
