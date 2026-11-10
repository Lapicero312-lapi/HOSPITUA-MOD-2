import { Module } from '@nestjs/common';
import { DailyListChangeRecorderService } from './daily-list-change-recorder.service.js';
import { GenerateDailyListService } from './generate-daily-list.service.js';
import { GetDaySummaryService } from './get-day-summary.service.js';
import { GetReservationDetailService } from './get-reservation-detail.service.js';
import { ListReservationsService } from './list-reservations.service.js';
import { DAILY_LIST_CHANGE_RECORDER } from './ports/in/daily-list-change-recorder.port.js';
import { GENERATE_DAILY_LIST } from './ports/in/generate-daily-list.port.js';
import { GET_DAY_SUMMARY } from './ports/in/get-day-summary.port.js';
import { GET_RESERVATION_DETAIL } from './ports/in/get-reservation-detail.port.js';
import { LIST_RESERVATIONS } from './ports/in/list-reservations.port.js';
import { RESERVATION_LOOKUP } from './ports/in/reservation-lookup.port.js';
import { ReservationLookupService } from './reservation-lookup.service.js';

/**
 * Los servicios de `check-view-reservation` (plan base, regla 4 de la arquitectura). Usa
 * `RESERVATION_QUERY_PORT`, `TRANSACTION_RUNNER`, `DAILY_SEQUENCE_REPOSITORY`, `DAILY_MESSAGE_REPOSITORY`,
 * `OTA_REPOSITORY`, `RESERVATION_REPOSITORY` y `CANCELLATION_REPOSITORY` de `PersistenceModule` y `CLOCK`
 * de `ClockModule`, que son globales.
 */
@Module({
  providers: [
    { provide: RESERVATION_LOOKUP, useClass: ReservationLookupService },
    {
      provide: DAILY_LIST_CHANGE_RECORDER,
      useClass: DailyListChangeRecorderService,
    },
    { provide: LIST_RESERVATIONS, useClass: ListReservationsService },
    { provide: GET_DAY_SUMMARY, useClass: GetDaySummaryService },
    { provide: GENERATE_DAILY_LIST, useClass: GenerateDailyListService },
    { provide: GET_RESERVATION_DETAIL, useClass: GetReservationDetailService },
  ],
  exports: [
    RESERVATION_LOOKUP,
    DAILY_LIST_CHANGE_RECORDER,
    LIST_RESERVATIONS,
    GET_DAY_SUMMARY,
    GENERATE_DAILY_LIST,
    GET_RESERVATION_DETAIL,
  ],
})
export class CheckViewReservationModule {}
