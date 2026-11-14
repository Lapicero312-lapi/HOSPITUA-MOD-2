import { Module } from '@nestjs/common';
import { CheckViewReservationModule } from '../check-view-reservation/check-view-reservation.module.js';
import { ConsultMaintenanceCalendarModule } from '../consult-maintenance-calendar/consult-maintenance-calendar.module.js';
import { ConsultRoomInventoryModule } from '../consult-room-inventory/consult-room-inventory.module.js';
import { VERIFY_AVAILABILITY } from './ports/in/verify-availability.port.js';
import { VerifyAvailabilityService } from './verify-availability.service.js';

/**
 * Los servicios de `check-room-availability` (plan base, regla 4 de la arquitectura). Usa
 * `MAINTENANCE_CONCURRENCY` de `Module1ClientModule`, que es global, y los puertos de entrada de
 * `consult-room-inventory`, `check-view-reservation` y `consult-maintenance-calendar` (regla 6).
 */
@Module({
  imports: [
    ConsultRoomInventoryModule,
    CheckViewReservationModule,
    ConsultMaintenanceCalendarModule,
  ],
  providers: [
    { provide: VERIFY_AVAILABILITY, useClass: VerifyAvailabilityService },
  ],
  exports: [VERIFY_AVAILABILITY],
})
export class CheckRoomAvailabilityModule {}
