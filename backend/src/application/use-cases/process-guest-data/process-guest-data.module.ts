import { Module } from '@nestjs/common';
import { ListGuestStaysService } from './list-guest-stays.service.js';
import { LIST_GUEST_STAYS } from './ports/in/list-guest-stays.port.js';

/**
 * Los servicios de `process-guest-data` (plan base, regla 4 de la arquitectura). Usa `GUEST_STAY_QUERY`
 * de `PersistenceModule` y `CLOCK` de `ClockModule`, que son globales.
 */
@Module({
  providers: [{ provide: LIST_GUEST_STAYS, useClass: ListGuestStaysService }],
  exports: [LIST_GUEST_STAYS],
})
export class ProcessGuestDataModule {}
