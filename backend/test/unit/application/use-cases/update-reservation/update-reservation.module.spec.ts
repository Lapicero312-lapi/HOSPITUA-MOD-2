import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { ARI_PENDING_CHANGE_REPOSITORY } from '../../../../../src/application/ports/out/ari-pending-change.repository.js';
import { CANCELLATION_REPOSITORY } from '../../../../../src/application/ports/out/cancellation.repository.js';
import { CHANNEX_SETUP_STATE } from '../../../../../src/application/ports/out/channex-setup-state.js';
import { CHANNEX_PORT } from '../../../../../src/application/ports/out/channex.port.js';
import { CLOCK } from '../../../../../src/application/ports/out/clock.js';
import { COMMISSION_AUDIT_REPOSITORY } from '../../../../../src/application/ports/out/commission-audit.repository.js';
import { EXCLUSIVE_RUNNER } from '../../../../../src/application/ports/out/exclusive-runner.js';
import { DAILY_LIST_PUBLISHER } from '../../../../../src/application/ports/out/daily-list-publisher.js';
import { DAILY_MESSAGE_REPOSITORY } from '../../../../../src/application/ports/out/daily-message.repository.js';
import { DAILY_SEQUENCE_REPOSITORY } from '../../../../../src/application/ports/out/daily-sequence.repository.js';
import { GUEST_DATA_REPOSITORY } from '../../../../../src/application/ports/out/guest-data.repository.js';
import { GUEST_STAY_QUERY } from '../../../../../src/application/ports/out/guest-stay.query.js';
import { MIGRATORY_MOVEMENT_REPOSITORY } from '../../../../../src/application/ports/out/migratory-movement.repository.js';
import { OTA_BOOKING_REVISION_REPOSITORY } from '../../../../../src/application/ports/out/ota-booking-revision.repository.js';
import { OTA_NO_SHOW_REPORT_REPOSITORY } from '../../../../../src/application/ports/out/ota-no-show-report.repository.js';
import { OTA_REPOSITORY } from '../../../../../src/application/ports/out/ota.repository.js';
import { PROCESSED_MESSAGE_REPOSITORY } from '../../../../../src/application/ports/out/processed-message.repository.js';
import { RESERVATION_QUERY_PORT } from '../../../../../src/application/ports/out/reservation-query.port.js';
import { RESERVATION_REPOSITORY } from '../../../../../src/application/ports/out/reservation.repository.js';
import { TRANSACTION_RUNNER } from '../../../../../src/application/ports/out/transaction.js';
import { CloseDayService } from '../../../../../src/application/use-cases/update-reservation/close-day.service.js';
import {
  CLOSE_DAY,
  CLOSE_DAY_BATCH_SIZE,
} from '../../../../../src/application/use-cases/update-reservation/ports/in/close-day.port.js';
import { PROCESS_CHECK_IN } from '../../../../../src/application/use-cases/update-reservation/ports/in/process-check-in.port.js';
import { PROCESS_CHECK_OUT } from '../../../../../src/application/use-cases/update-reservation/ports/in/process-check-out.port.js';
import { RESERVATION_STATUS } from '../../../../../src/application/use-cases/update-reservation/ports/in/reservation-status.port.js';
import { ProcessCheckInService } from '../../../../../src/application/use-cases/update-reservation/process-check-in.service.js';
import { ProcessCheckOutService } from '../../../../../src/application/use-cases/update-reservation/process-check-out.service.js';
import { ReservationStatusService } from '../../../../../src/application/use-cases/update-reservation/reservation-status.service.js';
import { UpdateReservationModule } from '../../../../../src/application/use-cases/update-reservation/update-reservation.module.js';

/**
 * Lo que ponen `PersistenceModule`, `ClockModule`, `ChannexClientModule` y `CloseDayConfigModule`, que son
 * globales: no se usan en esta prueba. Los de huéspedes los necesita `ProcessGuestDataModule` (por
 * `REGISTER_GUEST_MOVEMENTS`); los de la lista del día y su publicador, `CheckViewReservationModule` (por
 * `DAILY_LIST_CHANGE_RECORDER` y `PublishPendingDailyMessages`); y los de Channex y las agencias, `GenerateOtaReservationModule` (por
 * `OTA_NO_SHOW_REPORTER`).
 */
const GLOBALS = [
  RESERVATION_REPOSITORY,
  RESERVATION_QUERY_PORT,
  PROCESSED_MESSAGE_REPOSITORY,
  TRANSACTION_RUNNER,
  GUEST_DATA_REPOSITORY,
  MIGRATORY_MOVEMENT_REPOSITORY,
  GUEST_STAY_QUERY,
  DAILY_SEQUENCE_REPOSITORY,
  DAILY_MESSAGE_REPOSITORY,
  DAILY_LIST_PUBLISHER,
  EXCLUSIVE_RUNNER,
  OTA_REPOSITORY,
  CANCELLATION_REPOSITORY,
  COMMISSION_AUDIT_REPOSITORY,
  OTA_BOOKING_REVISION_REPOSITORY,
  OTA_NO_SHOW_REPORT_REPOSITORY,
  ARI_PENDING_CHANGE_REPOSITORY,
  CHANNEX_PORT,
  CHANNEX_SETUP_STATE,
  CLOSE_DAY_BATCH_SIZE,
  CLOCK,
];

@Global()
@Module({
  providers: GLOBALS.map((token) => ({ provide: token, useValue: {} })),
  exports: GLOBALS,
})
class FakePersistenceModule {}

const INJECTED = Symbol('INJECTED');

describe('UpdateReservationModule (plan base, regla 4)', () => {
  it.each([
    {
      token: RESERVATION_STATUS,
      service: ReservationStatusService,
      who: 'cancel-reservation (T025)',
    },
    {
      token: PROCESS_CHECK_IN,
      service: ProcessCheckInService,
      who: 'CheckInConsumer (T015)',
    },
    {
      token: PROCESS_CHECK_OUT,
      service: ProcessCheckOutService,
      who: 'CheckOutConsumer (T016)',
    },
    {
      token: CLOSE_DAY,
      service: CloseDayService,
      who: 'CloseDayJob (T022)',
    },
  ])(
    'exporta $token.description: $who lo puede inyectar',
    async ({ token, service }) => {
      const moduleRef = await Test.createTestingModule({
        imports: [FakePersistenceModule, UpdateReservationModule],
        // Un proveedor de fuera del módulo que lo inyecta: `moduleRef.get` lo encontraría aunque el módulo
        // no lo exportara; inyectarlo, no.
        providers: [
          {
            provide: INJECTED,
            inject: [token],
            useFactory: (injected: unknown) => injected,
          },
        ],
      }).compile();

      expect(moduleRef.get(INJECTED)).toBeInstanceOf(service);
      await moduleRef.close();
    },
  );
});
