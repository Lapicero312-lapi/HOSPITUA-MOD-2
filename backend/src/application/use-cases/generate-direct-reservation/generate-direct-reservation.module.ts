import { Module } from '@nestjs/common';
import { CalculateDynamicRateModule } from '../calculate-dynamic-rate/calculate-dynamic-rate.module.js';
import { CheckRoomAvailabilityModule } from '../check-room-availability/check-room-availability.module.js';
import { CheckViewReservationModule } from '../check-view-reservation/check-view-reservation.module.js';
import { CreateDirectReservationService } from './create-direct-reservation.service.js';
import { LookupGuestService } from './lookup-guest.service.js';
import { CREATE_DIRECT_RESERVATION } from './ports/in/create-direct-reservation.port.js';
import { LOOKUP_GUEST } from './ports/in/lookup-guest.port.js';
import { PREVIEW_DIRECT_RESERVATION } from './ports/in/preview-direct-reservation.port.js';
import { PreviewDirectReservationService } from './preview-direct-reservation.service.js';

/**
 * Los servicios de `generate-direct-reservation` (plan base, regla 4 de la arquitectura). Usa
 * `GUEST_REPOSITORY`, `RESERVATION_REPOSITORY` y `TRANSACTION_RUNNER` de `PersistenceModule` y `CLOCK` de
 * `ClockModule`, que son globales, y los puertos de entrada de `check-room-availability`,
 * `calculate-dynamic-rate` y `check-view-reservation` (`GetReservationDetail`, punto 12) (plan, D).
 */
@Module({
  imports: [
    CheckRoomAvailabilityModule,
    CalculateDynamicRateModule,
    CheckViewReservationModule,
  ],
  providers: [
    { provide: LOOKUP_GUEST, useClass: LookupGuestService },
    {
      provide: PREVIEW_DIRECT_RESERVATION,
      useClass: PreviewDirectReservationService,
    },
    {
      provide: CREATE_DIRECT_RESERVATION,
      useClass: CreateDirectReservationService,
    },
  ],
  exports: [
    LOOKUP_GUEST,
    PREVIEW_DIRECT_RESERVATION,
    CREATE_DIRECT_RESERVATION,
  ],
})
export class GenerateDirectReservationModule {}
