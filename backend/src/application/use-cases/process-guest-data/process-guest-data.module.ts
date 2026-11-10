import { Module } from '@nestjs/common';
import { GetGuestStayDetailService } from './get-guest-stay-detail.service.js';
import { ListGuestStaysService } from './list-guest-stays.service.js';
import { GET_GUEST_STAY_DETAIL } from './ports/in/get-guest-stay-detail.port.js';
import { LIST_GUEST_STAYS } from './ports/in/list-guest-stays.port.js';
import { REGISTER_GUEST_MOVEMENTS } from './ports/in/register-guest-movements.port.js';
import { SELECT_FOREIGN_MOVEMENTS } from './ports/in/select-foreign-movements.port.js';
import { RegisterGuestMovementsService } from './register-guest-movements.service.js';
import { SelectForeignMovementsService } from './select-foreign-movements.service.js';

/**
 * Los servicios de `process-guest-data` (plan base, regla 4 de la arquitectura). Usa
 * `RESERVATION_REPOSITORY`, `GUEST_DATA_REPOSITORY`, `MIGRATORY_MOVEMENT_REPOSITORY` y `GUEST_STAY_QUERY`
 * de `PersistenceModule` y `CLOCK` de `ClockModule`, que son globales.
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
    { provide: LIST_GUEST_STAYS, useClass: ListGuestStaysService },
    { provide: GET_GUEST_STAY_DETAIL, useClass: GetGuestStayDetailService },
  ],
  exports: [
    REGISTER_GUEST_MOVEMENTS,
    SELECT_FOREIGN_MOVEMENTS,
    LIST_GUEST_STAYS,
    GET_GUEST_STAY_DETAIL,
  ],
})
export class ProcessGuestDataModule {}
