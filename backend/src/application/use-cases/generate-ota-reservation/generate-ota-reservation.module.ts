import { Module } from '@nestjs/common';
import { RegisterOtaInformationCommissionModule } from '../register-ota-information-commission/register-ota-information-commission.module.js';
import { OtaNoShowReporterService } from './ota-no-show-reporter.service.js';
import { OTA_NO_SHOW_REPORTER } from './ports/in/ota-no-show-reporter.port.js';
import { PUBLISH_PENDING_NO_SHOWS } from './ports/in/publish-pending-no-shows.port.js';
import { READ_BOOKING_FEED } from './ports/in/read-booking-feed.port.js';
import { PublishPendingNoShowsService } from './publish-pending-no-shows.service.js';
import { ReadBookingFeedService } from './read-booking-feed.service.js';

/**
 * Los servicios de `generate-ota-reservation` (plan base, regla 4 de la arquitectura). Usa `CHANNEX_PORT`
 * de `ChannexClientModule`, `CLOCK` de `ClockModule` y los repositorios de `PersistenceModule`, que son
 * globales, y `ManageOta` y `OtaConnectionTracker` de `register-ota-information-commission`. Exporta
 * `OTA_NO_SHOW_REPORTER` para el cierre del día (`update-reservation`) y `PUBLISH_PENDING_NO_SHOWS` para
 * `ChannexSyncJob`.
 */
@Module({
  imports: [RegisterOtaInformationCommissionModule],
  providers: [
    { provide: READ_BOOKING_FEED, useClass: ReadBookingFeedService },
    { provide: OTA_NO_SHOW_REPORTER, useClass: OtaNoShowReporterService },
    {
      provide: PUBLISH_PENDING_NO_SHOWS,
      useClass: PublishPendingNoShowsService,
    },
  ],
  exports: [READ_BOOKING_FEED, OTA_NO_SHOW_REPORTER, PUBLISH_PENDING_NO_SHOWS],
})
export class GenerateOtaReservationModule {}
