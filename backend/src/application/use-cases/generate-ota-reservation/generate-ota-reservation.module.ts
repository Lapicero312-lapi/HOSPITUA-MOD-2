import { Module } from '@nestjs/common';
import { RegisterOtaInformationCommissionModule } from '../register-ota-information-commission/register-ota-information-commission.module.js';
import { READ_BOOKING_FEED } from './ports/in/read-booking-feed.port.js';
import { ReadBookingFeedService } from './read-booking-feed.service.js';

/**
 * Los servicios de `generate-ota-reservation` (plan base, regla 4 de la arquitectura). Usa `CHANNEX_PORT`
 * de `ChannexClientModule` y `CLOCK` de `ClockModule`, que son globales, y `ManageOta` y
 * `OtaConnectionTracker` de `register-ota-information-commission`.
 */
@Module({
  imports: [RegisterOtaInformationCommissionModule],
  providers: [{ provide: READ_BOOKING_FEED, useClass: ReadBookingFeedService }],
  exports: [READ_BOOKING_FEED],
})
export class GenerateOtaReservationModule {}
