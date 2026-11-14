import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { CHANNEX_PORT } from '../../../../../src/application/ports/out/channex.port.js';
import { CLOCK } from '../../../../../src/application/ports/out/clock.js';
import { COMMISSION_AUDIT_REPOSITORY } from '../../../../../src/application/ports/out/commission-audit.repository.js';
import { OTA_BOOKING_REVISION_REPOSITORY } from '../../../../../src/application/ports/out/ota-booking-revision.repository.js';
import { OTA_NO_SHOW_REPORT_REPOSITORY } from '../../../../../src/application/ports/out/ota-no-show-report.repository.js';
import { OTA_REPOSITORY } from '../../../../../src/application/ports/out/ota.repository.js';
import { RESERVATION_QUERY_PORT } from '../../../../../src/application/ports/out/reservation-query.port.js';
import { RESERVATION_REPOSITORY } from '../../../../../src/application/ports/out/reservation.repository.js';
import { TRANSACTION_RUNNER } from '../../../../../src/application/ports/out/transaction.js';
import { GenerateOtaReservationModule } from '../../../../../src/application/use-cases/generate-ota-reservation/generate-ota-reservation.module.js';
import { OtaNoShowReporterService } from '../../../../../src/application/use-cases/generate-ota-reservation/ota-no-show-reporter.service.js';
import { OTA_NO_SHOW_REPORTER } from '../../../../../src/application/use-cases/generate-ota-reservation/ports/in/ota-no-show-reporter.port.js';
import { PUBLISH_PENDING_NO_SHOWS } from '../../../../../src/application/use-cases/generate-ota-reservation/ports/in/publish-pending-no-shows.port.js';
import { READ_BOOKING_FEED } from '../../../../../src/application/use-cases/generate-ota-reservation/ports/in/read-booking-feed.port.js';
import { PublishPendingNoShowsService } from '../../../../../src/application/use-cases/generate-ota-reservation/publish-pending-no-shows.service.js';
import { ReadBookingFeedService } from '../../../../../src/application/use-cases/generate-ota-reservation/read-booking-feed.service.js';

/**
 * Lo que ponen `PersistenceModule`, `ClockModule` y `ChannexClientModule`, que son globales: no se usan en
 * esta prueba. Los de las agencias los necesita `RegisterOtaInformationCommissionModule`.
 */
const GLOBALS = [
  CHANNEX_PORT,
  CLOCK,
  OTA_REPOSITORY,
  RESERVATION_REPOSITORY,
  COMMISSION_AUDIT_REPOSITORY,
  OTA_BOOKING_REVISION_REPOSITORY,
  OTA_NO_SHOW_REPORT_REPOSITORY,
  RESERVATION_QUERY_PORT,
  TRANSACTION_RUNNER,
];

@Global()
@Module({
  providers: GLOBALS.map((token) => ({ provide: token, useValue: {} })),
  exports: GLOBALS,
})
class FakeGlobalModule {}

const INJECTED = Symbol('INJECTED');

describe('GenerateOtaReservationModule (plan base, regla 4)', () => {
  it.each([
    {
      token: READ_BOOKING_FEED,
      service: ReadBookingFeedService,
      who: 'ChannexSyncJob',
    },
    {
      token: OTA_NO_SHOW_REPORTER,
      service: OtaNoShowReporterService,
      who: 'CloseDay (update-reservation)',
    },
    {
      token: PUBLISH_PENDING_NO_SHOWS,
      service: PublishPendingNoShowsService,
      who: 'ChannexSyncJob',
    },
  ])(
    'exporta $token.description: $who lo puede inyectar',
    async ({ token, service }) => {
      const moduleRef = await Test.createTestingModule({
        imports: [FakeGlobalModule, GenerateOtaReservationModule],
        // Un proveedor de fuera del módulo que lo inyecta: `moduleRef.get` lo encontraría aunque el módulo no
        // lo exportara; inyectarlo, no.
        providers: [
          {
            provide: INJECTED,
            inject: [token],
            useFactory: (injected: unknown) => injected,
          },
        ],
      }).compile();

      expect(moduleRef.get(INJECTED)).toBeInstanceOf(service);
    },
  );
});
