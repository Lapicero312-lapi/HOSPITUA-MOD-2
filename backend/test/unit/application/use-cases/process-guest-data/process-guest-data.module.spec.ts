import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { GUEST_DATA_REPOSITORY } from '../../../../../src/application/ports/out/guest-data.repository.js';
import { MIGRATORY_MOVEMENT_REPOSITORY } from '../../../../../src/application/ports/out/migratory-movement.repository.js';
import { RESERVATION_REPOSITORY } from '../../../../../src/application/ports/out/reservation.repository.js';
import { REGISTER_GUEST_MOVEMENTS } from '../../../../../src/application/use-cases/process-guest-data/ports/in/register-guest-movements.port.js';
import { SELECT_FOREIGN_MOVEMENTS } from '../../../../../src/application/use-cases/process-guest-data/ports/in/select-foreign-movements.port.js';
import { ProcessGuestDataModule } from '../../../../../src/application/use-cases/process-guest-data/process-guest-data.module.js';
import { RegisterGuestMovementsService } from '../../../../../src/application/use-cases/process-guest-data/register-guest-movements.service.js';
import { SelectForeignMovementsService } from '../../../../../src/application/use-cases/process-guest-data/select-foreign-movements.service.js';

/** Lo que pone `PersistenceModule`, que es global: la base no se usa en esta prueba. */
@Global()
@Module({
  providers: [
    { provide: RESERVATION_REPOSITORY, useValue: {} },
    { provide: GUEST_DATA_REPOSITORY, useValue: {} },
    { provide: MIGRATORY_MOVEMENT_REPOSITORY, useValue: {} },
  ],
  exports: [
    RESERVATION_REPOSITORY,
    GUEST_DATA_REPOSITORY,
    MIGRATORY_MOVEMENT_REPOSITORY,
  ],
})
class FakePersistenceModule {}

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
  ])(
    'exporta $token.description: $who lo puede inyectar',
    async ({ token, service }) => {
      const moduleRef = await Test.createTestingModule({
        imports: [FakePersistenceModule, ProcessGuestDataModule],
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
