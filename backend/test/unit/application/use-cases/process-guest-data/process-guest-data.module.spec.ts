import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { CLOCK } from '../../../../../src/application/ports/out/clock.js';
import { GUEST_STAY_QUERY } from '../../../../../src/application/ports/out/guest-stay.query.js';
import { MIGRATORY_MOVEMENT_REPOSITORY } from '../../../../../src/application/ports/out/migratory-movement.repository.js';
import { ListGuestStaysService } from '../../../../../src/application/use-cases/process-guest-data/list-guest-stays.service.js';
import { LIST_GUEST_STAYS } from '../../../../../src/application/use-cases/process-guest-data/ports/in/list-guest-stays.port.js';
import { SELECT_FOREIGN_MOVEMENTS } from '../../../../../src/application/use-cases/process-guest-data/ports/in/select-foreign-movements.port.js';
import { ProcessGuestDataModule } from '../../../../../src/application/use-cases/process-guest-data/process-guest-data.module.js';
import { SelectForeignMovementsService } from '../../../../../src/application/use-cases/process-guest-data/select-foreign-movements.service.js';

/** Lo que ponen `PersistenceModule` y `ClockModule`, que son globales: no se usan en esta prueba. */
@Global()
@Module({
  providers: [
    { provide: MIGRATORY_MOVEMENT_REPOSITORY, useValue: {} },
    { provide: GUEST_STAY_QUERY, useValue: {} },
    { provide: CLOCK, useValue: {} },
  ],
  exports: [MIGRATORY_MOVEMENT_REPOSITORY, GUEST_STAY_QUERY, CLOCK],
})
class FakeGlobalModule {}

const INJECTED_SELECTION = Symbol('INJECTED_SELECTION');
const INJECTED_LISTING = Symbol('INJECTED_LISTING');

describe('ProcessGuestDataModule (plan base, regla 4)', () => {
  it('exporta SELECT_FOREIGN_MOVEMENTS y LIST_GUEST_STAYS: otros módulos los pueden inyectar', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [FakeGlobalModule, ProcessGuestDataModule],
      // Proveedores de fuera del módulo que los inyectan (como export-sire-file y el controlador de la
      // vista): `moduleRef.get` los encontraría aunque el módulo no los exportara; inyectarlos, no.
      providers: [
        {
          provide: INJECTED_SELECTION,
          inject: [SELECT_FOREIGN_MOVEMENTS],
          useFactory: (selection: unknown) => selection,
        },
        {
          provide: INJECTED_LISTING,
          inject: [LIST_GUEST_STAYS],
          useFactory: (listing: unknown) => listing,
        },
      ],
    }).compile();

    expect(moduleRef.get(INJECTED_SELECTION)).toBeInstanceOf(
      SelectForeignMovementsService,
    );
    expect(moduleRef.get(INJECTED_LISTING)).toBeInstanceOf(
      ListGuestStaysService,
    );
    await moduleRef.close();
  });
});
