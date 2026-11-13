import { Module } from '@nestjs/common';
import { CalculateDynamicRateModule } from '../calculate-dynamic-rate/calculate-dynamic-rate.module.js';
import { CheckRoomAvailabilityModule } from '../check-room-availability/check-room-availability.module.js';
import { CheckViewReservationModule } from '../check-view-reservation/check-view-reservation.module.js';
import { ConsultRoomInventoryModule } from '../consult-room-inventory/consult-room-inventory.module.js';
import { GenerateOtaReservationModule } from '../generate-ota-reservation/generate-ota-reservation.module.js';
import { ProcessGuestDataModule } from '../process-guest-data/process-guest-data.module.js';
import { CloseDayService } from './close-day.service.js';
import { CLOSE_DAY } from './ports/in/close-day.port.js';
import { PROCESS_CHECK_IN } from './ports/in/process-check-in.port.js';
import { PREVIEW_MODIFICATION } from './ports/in/preview-modification.port.js';
import { PROCESS_CHECK_OUT } from './ports/in/process-check-out.port.js';
import { RESERVATION_STATUS } from './ports/in/reservation-status.port.js';
import { ProcessCheckInService } from './process-check-in.service.js';
import { PreviewModificationService } from './preview-modification.service.js';
import { ProcessCheckOutService } from './process-check-out.service.js';
import { ReservationStatusService } from './reservation-status.service.js';
import { AssignRoomService } from './assign-room.service.js';
import { ASSIGN_ROOM } from './ports/in/assign-room.port.js';
import { ConfigureOtaModule } from '../configure-ota/configure-ota.module.js';
import { ConfirmModificationService } from './confirm-modification.service.js';
import { CONFIRM_MODIFICATION } from './ports/in/confirm-modification.port.js';

/**
 * Los servicios de `update-reservation` (plan base, regla 4 de la arquitectura). Exporta
 * `RESERVATION_STATUS` para `cancel-reservation` (T025), `PROCESS_CHECK_IN` y `PROCESS_CHECK_OUT` para
 * `CheckInConsumer` y `CheckOutConsumer` (T015 y T016), `CLOSE_DAY` para `CloseDayJob` (T022) y
 * `PREVIEW_MODIFICATION`, `CONFIRM_MODIFICATION` y `ASSIGN_ROOM` para `ReservationsController` (T009, T010 y T027,
 * que usa también `AriChangeRecorder` de `ConfigureOtaModule`). Importa `ProcessGuestDataModule` por
 * `REGISTER_GUEST_MOVEMENTS`, `CheckViewReservationModule` por `DAILY_LIST_CHANGE_RECORDER` y
 * `RESERVATION_LOOKUP`, `GenerateOtaReservationModule` por `OTA_NO_SHOW_REPORTER`, y
 * `ConsultRoomInventoryModule`, `CheckRoomAvailabilityModule` y `CalculateDynamicRateModule` por los puertos
 * de la modificación (reglas 8 y 9). `CheckViewReservationModule` da también `GET_RESERVATION_DETAIL` a la
 * confirmación. Usa
 * `RESERVATION_REPOSITORY`, `RESERVATION_QUERY_PORT`, `PROCESSED_MESSAGE_REPOSITORY` y `TRANSACTION_RUNNER`
 * de `PersistenceModule`, y `CLOSE_DAY_BATCH_SIZE` de `CloseDayConfigModule`, que son globales.
 */
@Module({
  imports: [
    ProcessGuestDataModule,
    CheckViewReservationModule,
    GenerateOtaReservationModule,
    ConsultRoomInventoryModule,
    CheckRoomAvailabilityModule,
    CalculateDynamicRateModule,
    ConfigureOtaModule,
  ],
  providers: [
    { provide: RESERVATION_STATUS, useClass: ReservationStatusService },
    { provide: PROCESS_CHECK_IN, useClass: ProcessCheckInService },
    { provide: PROCESS_CHECK_OUT, useClass: ProcessCheckOutService },
    { provide: CLOSE_DAY, useClass: CloseDayService },
    { provide: PREVIEW_MODIFICATION, useClass: PreviewModificationService },
    { provide: ASSIGN_ROOM, useClass: AssignRoomService },
    { provide: CONFIRM_MODIFICATION, useClass: ConfirmModificationService },
  ],
  exports: [
    RESERVATION_STATUS,
    PROCESS_CHECK_IN,
    PROCESS_CHECK_OUT,
    CLOSE_DAY,
    PREVIEW_MODIFICATION,
    ASSIGN_ROOM,
    CONFIRM_MODIFICATION,
  ],
})
export class UpdateReservationModule {}
