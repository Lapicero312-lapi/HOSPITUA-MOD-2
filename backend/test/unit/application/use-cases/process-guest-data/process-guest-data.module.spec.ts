import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { CLOCK } from '../../../../../src/application/ports/out/clock.js';
import { GUEST_DATA_REPOSITORY } from '../../../../../src/application/ports/out/guest-data.repository.js';
import { GUEST_STAY_QUERY } from '../../../../../src/application/ports/out/guest-stay.query.js';
import { MIGRATORY_MOVEMENT_REPOSITORY } from '../../../../../src/application/ports/out/migratory-movement.repository.js';
import { RESERVATION_REPOSITORY } from '../../../../../src/application/ports/out/reservation.repository.js';
import { ListGuestStaysService } from '../../../../../src/application/use-cases/process-guest-data/list-guest-stays.service.js';
import { LIST_GUEST_STAYS } from '../../../../../src/application/use-cases/process-guest-data/ports/in/list-guest-stays.port.js';
import { REGISTER_GUEST_MOVEMENTS } from '../../../../../src/application/use-cases/process-guest-data/ports/in/register-guest-movements.port.js';
import { SELECT_FOREIGN_MOVEMENTS } from '../../../../../src/application/use-cases/process-guest-data/ports/in/select-foreign-movements.port.js';
import { ProcessGuestDataModule } from '../../../../../src/application/use-cases/process-guest-data/process-guest-data.module.js';
import { RegisterGuestMovementsService } from '../../../../../src/application/use-cases/process-guest-data/register-guest-movements.service.js';
import { SelectForeignMovementsService } from '../../../../../src/application/use-cases/process-guest-data/select-foreign-movements.service.js';

/** Lo que ponen `PersistenceModule` y `ClockModule`, que son globales: no se usan en esta prueba. */
@Global()
@Module({
  providers: [
    { provide: RESERVATION_REPOSITORY, useValue: {} },
    { provide: GUEST_DATA_REPOSITORY, useValue: {} },
    { provide: MIGRATORY_MOVEMENT_REPOSITORY, useValue: {} },
    { provide: GUEST_STAY_QUERY, useValue: {} },
    { provide: CLOCK, useValue: {} },
  ],
  exports: [
    RESERVATION_REPOSITORY,
    GUEST_DATA_REPOSITORY,
    MIGRATORY_MOVEMENT_REPOSITORY,
    GUEST_STAY_QUERY,
    CLOCK,
  ],
})
class FakeGlobalModule {}

const INJECTED = Symbol('INJECTED');

describe('ProcessGuestDataModule (plan base, regla 4)', () => {
  it.each([
    {
      token: REGISTER_GUEST_MOVEMENTS,
      service: RegisterGuestMovementsService,
      who: 'update-reservation',
    },
    {
      token: SELECT_FOREIGN_MOVEMENTS,
      service: SelectForeignMovementsService,
      who: 'export-sire-file',
    },
    {
      token: LIST_GUEST_STAYS,
      service: ListGuestStaysService,
      who: 'el controlador de la vista',
    },
  ])(
    'exporta $token.description: $who lo puede inyectar',
    async ({ token, service }) => {
      const moduleRef = await Test.createTestingModule({
        imports: [FakeGlobalModule, ProcessGuestDataModule],
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
