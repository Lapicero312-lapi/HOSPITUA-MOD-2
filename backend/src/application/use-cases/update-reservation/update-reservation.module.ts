import { Module } from '@nestjs/common';
import { ProcessGuestDataModule } from '../process-guest-data/process-guest-data.module.js';
import { PROCESS_CHECK_IN } from './ports/in/process-check-in.port.js';
import { RESERVATION_STATUS } from './ports/in/reservation-status.port.js';
import { ProcessCheckInService } from './process-check-in.service.js';
import { ReservationStatusService } from './reservation-status.service.js';

/**
 * Los servicios de `update-reservation` (plan base, regla 4 de la arquitectura). Exporta
 * `RESERVATION_STATUS` para `cancel-reservation` (T025) y `PROCESS_CHECK_IN` para `CheckInConsumer`
 * (T015). Importa `ProcessGuestDataModule` por `REGISTER_GUEST_MOVEMENTS`, y usa
 * `RESERVATION_REPOSITORY`, `PROCESSED_MESSAGE_REPOSITORY` y `TRANSACTION_RUNNER` de `PersistenceModule`,
 * que es global.
 */
@Module({
  imports: [ProcessGuestDataModule],
  providers: [
    { provide: RESERVATION_STATUS, useClass: ReservationStatusService },
    { provide: PROCESS_CHECK_IN, useClass: ProcessCheckInService },
  ],
  exports: [RESERVATION_STATUS, PROCESS_CHECK_IN],
})
export class UpdateReservationModule {}
