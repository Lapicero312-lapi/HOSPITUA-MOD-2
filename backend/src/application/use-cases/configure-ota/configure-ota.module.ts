import { Module } from '@nestjs/common';
import { CheckViewReservationModule } from '../check-view-reservation/check-view-reservation.module.js';
import { ConsultMaintenanceCalendarModule } from '../consult-maintenance-calendar/consult-maintenance-calendar.module.js';
import { ConsultRoomInventoryModule } from '../consult-room-inventory/consult-room-inventory.module.js';
import { RegisterOtaInformationCommissionModule } from '../register-ota-information-commission/register-ota-information-commission.module.js';
import { AriChangeRecorderService } from './ari-change-recorder.service.js';
import { EnsureChannexSetupService } from './ensure-channex-setup.service.js';
import { HandleMaintenanceNoticeService } from './handle-maintenance-notice.service.js';
import { ARI_CHANGE_RECORDER } from './ports/in/ari-change-recorder.port.js';
import { ENSURE_CHANNEX_SETUP } from './ports/in/ensure-channex-setup.port.js';
import { HANDLE_MAINTENANCE_NOTICE } from './ports/in/handle-maintenance-notice.port.js';
import { PUBLISH_PENDING_AVAILABILITY } from './ports/in/publish-pending-availability.port.js';
import { VERIFY_CHANNEX_PROPERTY } from './ports/in/verify-channex-property.port.js';
import { PublishPendingAvailabilityService } from './publish-pending-availability.service.js';
import { VerifyChannexPropertyService } from './verify-channex-property.service.js';

/**
 * Los servicios de `configure-ota` (plan base, regla 4 de la arquitectura). Usa `CHANNEX_PORT` y
 * `CHANNEX_SETUP_STATE` de `ChannexClientModule`, `CLOCK` de `ClockModule` y
 * `ARI_PENDING_CHANGE_REPOSITORY`, `PROCESSED_MESSAGE_REPOSITORY` y `TRANSACTION_RUNNER` de `PersistenceModule`,
 * que son globales, y `ManageOta` de
 * `register-ota-information-commission`.
 */
@Module({
  imports: [
    RegisterOtaInformationCommissionModule,
    // B3 (T010): las vendibles, las ocupadas y los mantenimientos de cada categoría.
    ConsultRoomInventoryModule,
    CheckViewReservationModule,
    ConsultMaintenanceCalendarModule,
  ],
  providers: [
    {
      provide: VERIFY_CHANNEX_PROPERTY,
      useClass: VerifyChannexPropertyService,
    },
    { provide: ENSURE_CHANNEX_SETUP, useClass: EnsureChannexSetupService },
    { provide: ARI_CHANGE_RECORDER, useClass: AriChangeRecorderService },
    {
      provide: HANDLE_MAINTENANCE_NOTICE,
      useClass: HandleMaintenanceNoticeService,
    },
    {
      provide: PUBLISH_PENDING_AVAILABILITY,
      useClass: PublishPendingAvailabilityService,
    },
  ],
  exports: [
    VERIFY_CHANNEX_PROPERTY,
    ENSURE_CHANNEX_SETUP,
    ARI_CHANGE_RECORDER,
    HANDLE_MAINTENANCE_NOTICE,
    PUBLISH_PENDING_AVAILABILITY,
  ],
})
export class ConfigureOtaModule {}
