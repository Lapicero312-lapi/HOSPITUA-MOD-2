import { Module } from '@nestjs/common';
import { REGISTER_GUEST_MOVEMENTS } from './ports/in/register-guest-movements.port.js';
import { SELECT_FOREIGN_MOVEMENTS } from './ports/in/select-foreign-movements.port.js';
import { RegisterGuestMovementsService } from './register-guest-movements.service.js';
import { SelectForeignMovementsService } from './select-foreign-movements.service.js';

/**
 * Los servicios de `process-guest-data` (plan base, regla 4 de la arquitectura). Usa
 * `RESERVATION_REPOSITORY`, `GUEST_DATA_REPOSITORY` y `MIGRATORY_MOVEMENT_REPOSITORY` de
 * `PersistenceModule`, que es global.
 */
@Module({
  providers: [
    {
      provide: REGISTER_GUEST_MOVEMENTS,
      useClass: RegisterGuestMovementsService,
    },
    {
      provide: SELECT_FOREIGN_MOVEMENTS,
      useClass: SelectForeignMovementsService,
    },
  ],
  exports: [REGISTER_GUEST_MOVEMENTS, SELECT_FOREIGN_MOVEMENTS],
})
export class ProcessGuestDataModule {}
