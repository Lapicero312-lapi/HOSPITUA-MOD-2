import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { RESERVATION_REPOSITORY } from '../../../../../src/application/ports/out/reservation.repository.js';
import { RESERVATION_STATUS } from '../../../../../src/application/use-cases/update-reservation/ports/in/reservation-status.port.js';
import { ReservationStatusService } from '../../../../../src/application/use-cases/update-reservation/reservation-status.service.js';
import { UpdateReservationModule } from '../../../../../src/application/use-cases/update-reservation/update-reservation.module.js';

/** Lo que pone `PersistenceModule`, que es global: la base no se usa en esta prueba. */
@Global()
@Module({
  providers: [{ provide: RESERVATION_REPOSITORY, useValue: {} }],
  exports: [RESERVATION_REPOSITORY],
})
class FakePersistenceModule {}

const INJECTED_STATUS = Symbol('INJECTED_STATUS');

describe('UpdateReservationModule (plan base, regla 4; T025)', () => {
  it('exporta RESERVATION_STATUS: cancel-reservation lo puede inyectar', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [FakePersistenceModule, UpdateReservationModule],
      // Un proveedor de fuera del módulo que lo inyecta, como `CancelReservation`: `moduleRef.get` lo
      // encontraría aunque el módulo no lo exportara; inyectarlo, no.
      providers: [
        {
          provide: INJECTED_STATUS,
          inject: [RESERVATION_STATUS],
          useFactory: (status: unknown) => status,
        },
      ],
    }).compile();

    expect(moduleRef.get(INJECTED_STATUS)).toBeInstanceOf(
      ReservationStatusService,
    );
    await moduleRef.close();
  });
});
