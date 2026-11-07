import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { CANCELLATION_REPOSITORY } from '../../../../../src/application/ports/out/cancellation.repository.js';
import { CLOCK } from '../../../../../src/application/ports/out/clock.js';
import { DAILY_MESSAGE_REPOSITORY } from '../../../../../src/application/ports/out/daily-message.repository.js';
import { DAILY_SEQUENCE_REPOSITORY } from '../../../../../src/application/ports/out/daily-sequence.repository.js';
import { GUEST_DATA_REPOSITORY } from '../../../../../src/application/ports/out/guest-data.repository.js';
import { GUEST_STAY_QUERY } from '../../../../../src/application/ports/out/guest-stay.query.js';
import { MIGRATORY_MOVEMENT_REPOSITORY } from '../../../../../src/application/ports/out/migratory-movement.repository.js';
import { OTA_REPOSITORY } from '../../../../../src/application/ports/out/ota.repository.js';
import { PROCESSED_MESSAGE_REPOSITORY } from '../../../../../src/application/ports/out/processed-message.repository.js';
import { RESERVATION_QUERY_PORT } from '../../../../../src/application/ports/out/reservation-query.port.js';
import { RESERVATION_REPOSITORY } from '../../../../../src/application/ports/out/reservation.repository.js';
import { TRANSACTION_RUNNER } from '../../../../../src/application/ports/out/transaction.js';
import { CancelReservationModule } from '../../../../../src/application/use-cases/cancel-reservation/cancel-reservation.module.js';
import { CancelReservationService } from '../../../../../src/application/use-cases/cancel-reservation/cancel-reservation.service.js';
import { CANCEL_RESERVATION } from '../../../../../src/application/use-cases/cancel-reservation/ports/in/cancel-reservation.port.js';

/**
 * Todo lo que piden los módulos que importa `CancelReservationModule`, aunque hoy no lo usen: así la prueba
 * no se rompe cuando `CheckViewReservationModule` agrega `GenerateDailyList` (`TRANSACTION_RUNNER`, #500) o
 * `UpdateReservationModule` agrega el Check-In e importa `ProcessGuestDataModule` (sus repositorios y
 * `GUEST_STAY_QUERY`, #508).
 */
const GLOBAL_TOKENS = [
  RESERVATION_REPOSITORY,
  RESERVATION_QUERY_PORT,
  DAILY_SEQUENCE_REPOSITORY,
  DAILY_MESSAGE_REPOSITORY,
  OTA_REPOSITORY,
  CANCELLATION_REPOSITORY,
  CLOCK,
  TRANSACTION_RUNNER,
  PROCESSED_MESSAGE_REPOSITORY,
  GUEST_DATA_REPOSITORY,
  MIGRATORY_MOVEMENT_REPOSITORY,
  GUEST_STAY_QUERY,
];

/** Lo que ponen `PersistenceModule` y `ClockModule`, que son globales: la base no se usa en esta prueba. */
@Global()
@Module({
  providers: GLOBAL_TOKENS.map((token) => ({ provide: token, useValue: {} })),
  exports: GLOBAL_TOKENS,
})
class FakeGlobalModule {}

const INJECTED_CANCEL = Symbol('INJECTED_CANCEL');

describe('CancelReservationModule (plan base, regla 4; punto 10 del plan de cancel-reservation)', () => {
  it('arma CancelReservation con los puertos de check-view-reservation y update-reservation, y lo exporta', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [FakeGlobalModule, CancelReservationModule],
      // Un proveedor de fuera del módulo que lo inyecta, como `generate-ota-reservation` (canal B):
      // `moduleRef.get` lo encontraría aunque el módulo no lo exportara; inyectarlo, no.
      providers: [
        {
          provide: INJECTED_CANCEL,
          inject: [CANCEL_RESERVATION],
          useFactory: (cancel: unknown) => cancel,
        },
      ],
    }).compile();

    expect(moduleRef.get(INJECTED_CANCEL)).toBeInstanceOf(
      CancelReservationService,
    );
    await moduleRef.close();
  });
});
