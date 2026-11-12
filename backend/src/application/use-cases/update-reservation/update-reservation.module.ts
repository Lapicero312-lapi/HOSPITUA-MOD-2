import { Module } from '@nestjs/common';
import { CheckViewReservationModule } from '../check-view-reservation/check-view-reservation.module.js';
import { GenerateOtaReservationModule } from '../generate-ota-reservation/generate-ota-reservation.module.js';
import { ProcessGuestDataModule } from '../process-guest-data/process-guest-data.module.js';
import { CloseDayService } from './close-day.service.js';
import { CLOSE_DAY } from './ports/in/close-day.port.js';
import { PROCESS_CHECK_IN } from './ports/in/process-check-in.port.js';
import { PROCESS_CHECK_OUT } from './ports/in/process-check-out.port.js';
import { RESERVATION_STATUS } from './ports/in/reservation-status.port.js';
import { ProcessCheckInService } from './process-check-in.service.js';
import { ProcessCheckOutService } from './process-check-out.service.js';
import { ReservationStatusService } from './reservation-status.service.js';

/**
 * Los servicios de `update-reservation` (plan base, regla 4 de la arquitectura). Exporta
 * `RESERVATION_STATUS` para `cancel-reservation` (T025), `PROCESS_CHECK_IN` y `PROCESS_CHECK_OUT` para
 * `CheckInConsumer` y `CheckOutConsumer` (T015 y T016), y `CLOSE_DAY` para `CloseDayJob` (T022). Importa
 * `ProcessGuestDataModule` por `REGISTER_GUEST_MOVEMENTS`, `CheckViewReservationModule` por
 * `DAILY_LIST_CHANGE_RECORDER` y `GenerateOtaReservationModule` por `OTA_NO_SHOW_REPORTER`. Usa
 * `RESERVATION_REPOSITORY`, `RESERVATION_QUERY_PORT`, `PROCESSED_MESSAGE_REPOSITORY` y `TRANSACTION_RUNNER`
 * de `PersistenceModule`, y `CLOSE_DAY_BATCH_SIZE` de `CloseDayConfigModule`, que son globales.
 */
@Module({
  imports: [
    ProcessGuestDataModule,
    CheckViewReservationModule,
    GenerateOtaReservationModule,
  ],
  providers: [
    { provide: RESERVATION_STATUS, useClass: ReservationStatusService },
    { provide: PROCESS_CHECK_IN, useClass: ProcessCheckInService },
    { provide: PROCESS_CHECK_OUT, useClass: ProcessCheckOutService },
    { provide: CLOSE_DAY, useClass: CloseDayService },
  ],
  exports: [RESERVATION_STATUS, PROCESS_CHECK_IN, PROCESS_CHECK_OUT, CLOSE_DAY],
})
export class UpdateReservationModule {}
