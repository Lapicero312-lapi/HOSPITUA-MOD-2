import { Module } from '@nestjs/common';
import { CalculateDynamicRateModule } from '../calculate-dynamic-rate/calculate-dynamic-rate.module.js';
import { CheckRoomAvailabilityModule } from '../check-room-availability/check-room-availability.module.js';
import { LookupGuestService } from './lookup-guest.service.js';
import { LOOKUP_GUEST } from './ports/in/lookup-guest.port.js';
import { PREVIEW_DIRECT_RESERVATION } from './ports/in/preview-direct-reservation.port.js';
import { PreviewDirectReservationService } from './preview-direct-reservation.service.js';

/**
 * Los servicios de `generate-direct-reservation` (plan base, regla 4 de la arquitectura). Usa
 * `GUEST_REPOSITORY` de `PersistenceModule` y `CLOCK` de `ClockModule`, que son globales, y los puertos de
 * entrada de `check-room-availability` y `calculate-dynamic-rate` (plan, D).
 */
@Module({
  imports: [CheckRoomAvailabilityModule, CalculateDynamicRateModule],
  providers: [
    { provide: LOOKUP_GUEST, useClass: LookupGuestService },
    {
      provide: PREVIEW_DIRECT_RESERVATION,
      useClass: PreviewDirectReservationService,
    },
  ],
  exports: [LOOKUP_GUEST, PREVIEW_DIRECT_RESERVATION],
})
export class GenerateDirectReservationModule {}
