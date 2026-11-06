import { Module } from '@nestjs/common';
import { RESERVATION_LOOKUP } from './ports/in/reservation-lookup.port.js';
import { ReservationLookupService } from './reservation-lookup.service.js';

/**
 * Los servicios de `check-view-reservation` (plan base, regla 4 de la arquitectura). Usa
 * `RESERVATION_QUERY_PORT` de `PersistenceModule`, que es global.
 */
@Module({
  providers: [
    { provide: RESERVATION_LOOKUP, useClass: ReservationLookupService },
  ],
  exports: [RESERVATION_LOOKUP],
})
export class CheckViewReservationModule {}
