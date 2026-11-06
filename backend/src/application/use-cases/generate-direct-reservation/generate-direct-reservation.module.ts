import { Module } from '@nestjs/common';
import { LookupGuestService } from './lookup-guest.service.js';
import { LOOKUP_GUEST } from './ports/in/lookup-guest.port.js';

/**
 * Los servicios de `generate-direct-reservation` (plan base, regla 4 de la arquitectura). Usa
 * `GUEST_REPOSITORY` de `PersistenceModule`, que es global.
 */
@Module({
  providers: [{ provide: LOOKUP_GUEST, useClass: LookupGuestService }],
  exports: [LOOKUP_GUEST],
})
export class GenerateDirectReservationModule {}
