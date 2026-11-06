import { Module } from '@nestjs/common';
import { RESERVATION_STATUS } from './ports/in/reservation-status.port.js';
import { ReservationStatusService } from './reservation-status.service.js';

/**
 * Los servicios de `update-reservation` (plan base, regla 4 de la arquitectura). Exporta
 * `RESERVATION_STATUS` para `cancel-reservation` (T025). Usa `RESERVATION_REPOSITORY` de
 * `PersistenceModule`, que es global.
 */
@Module({
  providers: [
    { provide: RESERVATION_STATUS, useClass: ReservationStatusService },
  ],
  exports: [RESERVATION_STATUS],
})
export class UpdateReservationModule {}
