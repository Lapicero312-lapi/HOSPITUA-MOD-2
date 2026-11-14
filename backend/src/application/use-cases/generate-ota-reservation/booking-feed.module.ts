import { Module } from '@nestjs/common';
import { CancelReservationModule } from '../cancel-reservation/cancel-reservation.module.js';
import { CheckRoomAvailabilityModule } from '../check-room-availability/check-room-availability.module.js';
import { CheckViewReservationModule } from '../check-view-reservation/check-view-reservation.module.js';
import { ConfigureOtaModule } from '../configure-ota/configure-ota.module.js';
import { RegisterOtaInformationCommissionModule } from '../register-ota-information-commission/register-ota-information-commission.module.js';
import { UpdateReservationModule } from '../update-reservation/update-reservation.module.js';
import { GenerateOtaReservationModule } from './generate-ota-reservation.module.js';
import { PROCESS_BOOKING_FEED } from './ports/in/process-booking-feed.port.js';
import { PROCESS_BOOKING_REVISION } from './ports/in/process-booking-revision.port.js';
import { ProcessBookingFeedService } from './process-booking-feed.service.js';
import { ProcessBookingRevisionService } from './process-booking-revision.service.js';

/**
 * El procesamiento del feed de Booking de `generate-ota-reservation` (punto 9 de su plan; T006, T007, T009,
 * T010 y T011c), en un módulo aparte de `GenerateOtaReservationModule`.
 *
 * **Por qué aparte:** la cancelación de Booking (B3) usa `CancelReservation`, cuyo módulo importa
 * `UpdateReservationModule`, que a su vez importa `GenerateOtaReservationModule` por `OTA_NO_SHOW_REPORTER`.
 * Lo mismo pasa con el cambio de Booking (B2), que usa `APPLY_OTA_CHANGE` de `UpdateReservationModule`.
 * Si `GenerateOtaReservationModule` importara `CancelReservationModule`, los archivos formarían un ciclo,
 * que `pnpm lint` rechaza (regla `sin-ciclos`). Este módulo importa a los dos y nadie lo importa a él salvo
 * `JobsModule`, así que no hay ciclo ni hace falta `forwardRef`. Los otros casos de uso se usan solo por sus
 * puertos de entrada (regla 6 del plan base).
 *
 * Usa `OTA_BOOKING_REVISION_REPOSITORY`, `OTA_ROOM_TYPE_MAPPING_REPOSITORY`, `RESERVATION_REPOSITORY` y
 * `TRANSACTION_RUNNER` de `PersistenceModule`, `CHANNEX_PORT` de `ChannexClientModule` y `CLOCK` de
 * `ClockModule`, que son globales.
 */
@Module({
  imports: [
    GenerateOtaReservationModule,
    RegisterOtaInformationCommissionModule,
    CheckRoomAvailabilityModule,
    CheckViewReservationModule,
    ConfigureOtaModule,
    CancelReservationModule,
    UpdateReservationModule,
  ],
  providers: [
    {
      provide: PROCESS_BOOKING_REVISION,
      useClass: ProcessBookingRevisionService,
    },
    { provide: PROCESS_BOOKING_FEED, useClass: ProcessBookingFeedService },
  ],
  exports: [PROCESS_BOOKING_FEED],
})
export class BookingFeedModule {}
