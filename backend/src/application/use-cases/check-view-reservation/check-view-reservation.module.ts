import { Module } from '@nestjs/common';
import { DailyListChangeRecorderService } from './daily-list-change-recorder.service.js';
import { FindReservationsByStayRangeService } from './find-reservations-by-stay-range.service.js';
import { GenerateDailyListService } from './generate-daily-list.service.js';
import { GetDaySummaryService } from './get-day-summary.service.js';
import { GetReservationDetailService } from './get-reservation-detail.service.js';
import { GetReservationForBillingService } from './get-reservation-for-billing.service.js';
import { ListReservationsService } from './list-reservations.service.js';
import { DAILY_LIST_CHANGE_RECORDER } from './ports/in/daily-list-change-recorder.port.js';
import { FIND_RESERVATIONS_BY_STAY_RANGE } from './ports/in/find-reservations-by-stay-range.port.js';
import { GENERATE_DAILY_LIST } from './ports/in/generate-daily-list.port.js';
import { GET_DAY_SUMMARY } from './ports/in/get-day-summary.port.js';
import { GET_RESERVATION_DETAIL } from './ports/in/get-reservation-detail.port.js';
import { GET_RESERVATION_FOR_BILLING } from './ports/in/get-reservation-for-billing.port.js';
import { LIST_RESERVATIONS } from './ports/in/list-reservations.port.js';
import { RESERVATION_LOOKUP } from './ports/in/reservation-lookup.port.js';
import { PUBLISH_PENDING_DAILY_MESSAGES } from './ports/in/publish-pending-daily-messages.port.js';
import { PublishPendingDailyMessagesService } from './publish-pending-daily-messages.service.js';
import { ReservationLookupService } from './reservation-lookup.service.js';

/**
 * Los servicios de `check-view-reservation` (plan base, regla 4 de la arquitectura). Usa
 * `RESERVATION_QUERY_PORT`, `TRANSACTION_RUNNER`, `DAILY_SEQUENCE_REPOSITORY`, `DAILY_MESSAGE_REPOSITORY`,
 * `OTA_REPOSITORY`, `RESERVATION_REPOSITORY` y `CANCELLATION_REPOSITORY` de `PersistenceModule`, `CLOCK`
 * de `ClockModule` y `DAILY_LIST_PUBLISHER` de `MessagingModule`, que son globales.
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
    {
      provide: GET_RESERVATION_FOR_BILLING,
      useClass: GetReservationForBillingService,
    },
    {
      provide: FIND_RESERVATIONS_BY_STAY_RANGE,
      useClass: FindReservationsByStayRangeService,
    },
    {
      provide: PUBLISH_PENDING_DAILY_MESSAGES,
      useClass: PublishPendingDailyMessagesService,
    },
  ],
  exports: [
    RESERVATION_LOOKUP,
    DAILY_LIST_CHANGE_RECORDER,
    LIST_RESERVATIONS,
    GET_DAY_SUMMARY,
    GENERATE_DAILY_LIST,
    GET_RESERVATION_DETAIL,
    GET_RESERVATION_FOR_BILLING,
    FIND_RESERVATIONS_BY_STAY_RANGE,
    PUBLISH_PENDING_DAILY_MESSAGES,
  ],
})
export class CheckViewReservationModule {}
