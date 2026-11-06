import { Module } from '@nestjs/common';
import { DailyListChangeRecorderService } from './daily-list-change-recorder.service.js';
import { DAILY_LIST_CHANGE_RECORDER } from './ports/in/daily-list-change-recorder.port.js';

/**
 * Los servicios de `check-view-reservation` (plan base, regla 4 de la arquitectura). Usa
 * `DAILY_SEQUENCE_REPOSITORY`, `DAILY_MESSAGE_REPOSITORY` y `OTA_REPOSITORY` de `PersistenceModule` y
 * `CLOCK` de `ClockModule`, que son globales.
 */
@Module({
  providers: [
    {
      provide: DAILY_LIST_CHANGE_RECORDER,
      useClass: DailyListChangeRecorderService,
    },
  ],
  exports: [DAILY_LIST_CHANGE_RECORDER],
})
export class CheckViewReservationModule {}
