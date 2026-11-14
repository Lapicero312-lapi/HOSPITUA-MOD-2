import { Module } from '@nestjs/common';
import { CheckViewReservationModule } from '../check-view-reservation/check-view-reservation.module.js';
import { ConfigureOtaModule } from '../configure-ota/configure-ota.module.js';
import { UpdateReservationModule } from '../update-reservation/update-reservation.module.js';
import { CancelReservationService } from './cancel-reservation.service.js';
import { CANCEL_RESERVATION } from './ports/in/cancel-reservation.port.js';

/**
 * Los servicios de `cancel-reservation` (plan base, regla 4 de la arquitectura). Usa los puertos de entrada
 * de `check-view-reservation`, `update-reservation` y `configure-ota` (regla 6), y `CANCELLATION_REPOSITORY`
 * y `CLOCK` de `PersistenceModule` y `ClockModule`, que son globales.
 */
@Module({
  imports: [
    CheckViewReservationModule,
    UpdateReservationModule,
    ConfigureOtaModule,
  ],
  providers: [
    { provide: CANCEL_RESERVATION, useClass: CancelReservationService },
  ],
  exports: [CANCEL_RESERVATION],
})
export class CancelReservationModule {}
