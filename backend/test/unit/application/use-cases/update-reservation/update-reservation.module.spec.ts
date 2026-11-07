import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { GUEST_DATA_REPOSITORY } from '../../../../../src/application/ports/out/guest-data.repository.js';
import { MIGRATORY_MOVEMENT_REPOSITORY } from '../../../../../src/application/ports/out/migratory-movement.repository.js';
import { PROCESSED_MESSAGE_REPOSITORY } from '../../../../../src/application/ports/out/processed-message.repository.js';
import { RESERVATION_REPOSITORY } from '../../../../../src/application/ports/out/reservation.repository.js';
import { TRANSACTION_RUNNER } from '../../../../../src/application/ports/out/transaction.js';
import { PROCESS_CHECK_IN } from '../../../../../src/application/use-cases/update-reservation/ports/in/process-check-in.port.js';
import { RESERVATION_STATUS } from '../../../../../src/application/use-cases/update-reservation/ports/in/reservation-status.port.js';
import { ProcessCheckInService } from '../../../../../src/application/use-cases/update-reservation/process-check-in.service.js';
import { ReservationStatusService } from '../../../../../src/application/use-cases/update-reservation/reservation-status.service.js';
import { UpdateReservationModule } from '../../../../../src/application/use-cases/update-reservation/update-reservation.module.js';

/** Lo que pone `PersistenceModule`, que es global: la base no se usa en esta prueba. */
const GLOBALS = [
  RESERVATION_REPOSITORY,
  PROCESSED_MESSAGE_REPOSITORY,
  TRANSACTION_RUNNER,
  GUEST_DATA_REPOSITORY,
  MIGRATORY_MOVEMENT_REPOSITORY,
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
