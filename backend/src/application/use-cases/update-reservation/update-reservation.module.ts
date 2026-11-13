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
import { ApplyOtaChangeService } from './apply-ota-change.service.js';
import { APPLY_OTA_CHANGE } from './ports/in/apply-ota-change.port.js';
import { RegisterOtaInformationCommissionModule } from '../register-ota-information-commission/register-ota-information-commission.module.js';
import { ConfigureOtaModule } from '../configure-ota/configure-ota.module.js';

/**
 * Los servicios de `update-reservation` (plan base, regla 4 de la arquitectura). Exporta
 * `RESERVATION_STATUS` para `cancel-reservation` (T025), `PROCESS_CHECK_IN` y `PROCESS_CHECK_OUT` para
 * `CheckInConsumer` y `CheckOutConsumer` (T015 y T016), `CLOSE_DAY` para `CloseDayJob` (T022) y
 * `PREVIEW_MODIFICATION` para `ReservationsController` (T009) y `APPLY_OTA_CHANGE` para
 * `generate-ota-reservation` (T026, con `RegisterOtaInformationCommissionModule` y `ConfigureOtaModule`). Importa `ProcessGuestDataModule` por
 * `REGISTER_GUEST_MOVEMENTS`, `CheckViewReservationModule` por `DAILY_LIST_CHANGE_RECORDER` y
 * `RESERVATION_LOOKUP`, `GenerateOtaReservationModule` por `OTA_NO_SHOW_REPORTER`, y
 * `ConsultRoomInventoryModule`, `CheckRoomAvailabilityModule` y `CalculateDynamicRateModule` por los puertos
 * de la modificación (regla 8). Usa
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
    RegisterOtaInformationCommissionModule,
    ConfigureOtaModule,
  ],
  providers: [
    { provide: RESERVATION_STATUS, useClass: ReservationStatusService },
    { provide: PROCESS_CHECK_IN, useClass: ProcessCheckInService },
    { provide: PROCESS_CHECK_OUT, useClass: ProcessCheckOutService },
    { provide: CLOSE_DAY, useClass: CloseDayService },
    { provide: PREVIEW_MODIFICATION, useClass: PreviewModificationService },
    { provide: APPLY_OTA_CHANGE, useClass: ApplyOtaChangeService },
  ],
  exports: [
    RESERVATION_STATUS,
    PROCESS_CHECK_IN,
    PROCESS_CHECK_OUT,
    CLOSE_DAY,
    PREVIEW_MODIFICATION,
    APPLY_OTA_CHANGE,
  ],
})
export class UpdateReservationModule {}
