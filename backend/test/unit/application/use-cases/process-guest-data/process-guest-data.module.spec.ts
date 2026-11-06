import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { MIGRATORY_MOVEMENT_REPOSITORY } from '../../../../../src/application/ports/out/migratory-movement.repository.js';
import { SELECT_FOREIGN_MOVEMENTS } from '../../../../../src/application/use-cases/process-guest-data/ports/in/select-foreign-movements.port.js';
import { ProcessGuestDataModule } from '../../../../../src/application/use-cases/process-guest-data/process-guest-data.module.js';
import { SelectForeignMovementsService } from '../../../../../src/application/use-cases/process-guest-data/select-foreign-movements.service.js';

/** Lo que pone `PersistenceModule`, que es global: la base no se usa en esta prueba. */
@Global()
@Module({
  providers: [{ provide: MIGRATORY_MOVEMENT_REPOSITORY, useValue: {} }],
  exports: [MIGRATORY_MOVEMENT_REPOSITORY],
})
class FakePersistenceModule {}

const INJECTED_SELECTION = Symbol('INJECTED_SELECTION');

describe('ProcessGuestDataModule (plan base, regla 4)', () => {
  it('exporta SELECT_FOREIGN_MOVEMENTS: export-sire-file lo puede inyectar', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [FakePersistenceModule, ProcessGuestDataModule],
      // Un proveedor de fuera del módulo que lo inyecta: `moduleRef.get` lo encontraría aunque el módulo no
      // lo exportara; inyectarlo, no.
      providers: [
        {
          provide: INJECTED_SELECTION,
          inject: [SELECT_FOREIGN_MOVEMENTS],
          useFactory: (selection: unknown) => selection,
        },
      ],
    }).compile();

    expect(moduleRef.get(INJECTED_SELECTION)).toBeInstanceOf(
      SelectForeignMovementsService,
    );
    await moduleRef.close();
  });
});
