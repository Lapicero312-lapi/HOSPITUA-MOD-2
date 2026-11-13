import { Global, Module } from '@nestjs/common';
import {
  DAILY_LIST_PUBLISHER,
  type DailyListPublisher,
} from '../../../src/application/ports/out/daily-list-publisher.js';

/**
 * Lo que pone `MessagingModule`, que es global, para las pruebas que arman `CheckViewReservationModule`
 * sin RabbitMQ: `PublishPendingDailyMessages` (T026) pide el publicador aunque la prueba no publique.
 */
@Global()
@Module({
  providers: [
    {
      provide: DAILY_LIST_PUBLISHER,
      useValue: {
        publish: () =>
          Promise.reject(new Error('Esta prueba no publica en RabbitMQ')),
      } satisfies DailyListPublisher,
    },
  ],
  exports: [DAILY_LIST_PUBLISHER],
})
export class FakeDailyListPublisherModule {}
