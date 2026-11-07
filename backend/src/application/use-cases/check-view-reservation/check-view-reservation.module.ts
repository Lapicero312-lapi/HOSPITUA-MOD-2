import { Module } from '@nestjs/common';
import { DailyListChangeRecorderService } from './daily-list-change-recorder.service.js';
import { ListReservationsService } from './list-reservations.service.js';
import { DAILY_LIST_CHANGE_RECORDER } from './ports/in/daily-list-change-recorder.port.js';
import { LIST_RESERVATIONS } from './ports/in/list-reservations.port.js';
import { RESERVATION_LOOKUP } from './ports/in/reservation-lookup.port.js';
import { ReservationLookupService } from './reservation-lookup.service.js';

/**
 * Los servicios de `check-view-reservation` (plan base, regla 4 de la arquitectura). Usa
 * `RESERVATION_QUERY_PORT`, `DAILY_SEQUENCE_REPOSITORY`, `DAILY_MESSAGE_REPOSITORY` y `OTA_REPOSITORY` de
 * `PersistenceModule` y `CLOCK` de `ClockModule`, que son globales.
 */
@Module({
  providers: [
    { provide: RESERVATION_LOOKUP, useClass: ReservationLookupService },
    {
      provide: DAILY_LIST_CHANGE_RECORDER,
      useClass: DailyListChangeRecorderService,
    },
    { provide: LIST_RESERVATIONS, useClass: ListReservationsService },
  ],
  exports: [RESERVATION_LOOKUP, DAILY_LIST_CHANGE_RECORDER, LIST_RESERVATIONS],
})
export class CheckViewReservationModule {}
