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
import { PUBLISH_DAILY_AVAILABILITY } from './ports/in/publish-daily-availability.port.js';
import { PUBLISH_PENDING_AVAILABILITY } from './ports/in/publish-pending-availability.port.js';
import { SYNC_ROOM_TYPES } from './ports/in/sync-room-types.port.js';
import { VERIFY_CHANNEX_PROPERTY } from './ports/in/verify-channex-property.port.js';
import { PublishDailyAvailabilityService } from './publish-daily-availability.service.js';
import { PublishPendingAvailabilityService } from './publish-pending-availability.service.js';
import { SyncRoomTypesService } from './sync-room-types.service.js';
import { VerifyChannexPropertyService } from './verify-channex-property.service.js';

/**
 * Los servicios de `configure-ota` (plan base, regla 4 de la arquitectura). Usa `CHANNEX_PORT` y
 * `CHANNEX_SETUP_STATE` de `ChannexClientModule`, `CLOCK` de `ClockModule` y
 * `ARI_PENDING_CHANGE_REPOSITORY`, `PROCESSED_MESSAGE_REPOSITORY`, `TRANSACTION_RUNNER` y
 * `OTA_ROOM_TYPE_MAPPING_REPOSITORY` de `PersistenceModule`, que son globales; `ManageOta` y
 * `OtaConnectionTracker` de `register-ota-information-commission`, `ConsultRoomInventory` de
 * `consult-room-inventory` (`SyncRoomTypes`, T007, y la disponibilidad, T010), y `ReservationLookup` de
 * `check-view-reservation` y `ConsultMaintenanceCalendar` de `consult-maintenance-calendar` (la
 * disponibilidad, T010).
 */
@Module({
  imports: [
    RegisterOtaInformationCommissionModule,
    // SyncRoomTypes (T007) y B3 (T010): las habitaciones de cada categoría.
    ConsultRoomInventoryModule,
    // B3 (T010): las ocupadas y los mantenimientos de cada categoría.
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
    { provide: SYNC_ROOM_TYPES, useClass: SyncRoomTypesService },
    {
      provide: HANDLE_MAINTENANCE_NOTICE,
      useClass: HandleMaintenanceNoticeService,
    },
    {
      provide: PUBLISH_PENDING_AVAILABILITY,
      useClass: PublishPendingAvailabilityService,
    },
    {
      provide: PUBLISH_DAILY_AVAILABILITY,
      useClass: PublishDailyAvailabilityService,
    },
  ],
  exports: [
    VERIFY_CHANNEX_PROPERTY,
    ENSURE_CHANNEX_SETUP,
    ARI_CHANGE_RECORDER,
    HANDLE_MAINTENANCE_NOTICE,
    SYNC_ROOM_TYPES,
    PUBLISH_PENDING_AVAILABILITY,
    PUBLISH_DAILY_AVAILABILITY,
  ],
})
export class ConfigureOtaModule {}
