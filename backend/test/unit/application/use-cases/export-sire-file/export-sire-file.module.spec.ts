import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { CLOCK } from '../../../../../src/application/ports/out/clock.js';
import { GUEST_DATA_REPOSITORY } from '../../../../../src/application/ports/out/guest-data.repository.js';
import { GUEST_STAY_QUERY } from '../../../../../src/application/ports/out/guest-stay.query.js';
import { MIGRATORY_MOVEMENT_REPOSITORY } from '../../../../../src/application/ports/out/migratory-movement.repository.js';
import { RESERVATION_REPOSITORY } from '../../../../../src/application/ports/out/reservation.repository.js';
import { SIRE_CONFIG } from '../../../../../src/application/ports/out/sire-config.js';
import { SIRE_EXPORT_REPOSITORY } from '../../../../../src/application/ports/out/sire-export.repository.js';
import { ExportSireFileModule } from '../../../../../src/application/use-cases/export-sire-file/export-sire-file.module.js';
import { ExportSireFileService } from '../../../../../src/application/use-cases/export-sire-file/export-sire-file.service.js';
import { ListSireMovementsService } from '../../../../../src/application/use-cases/export-sire-file/list-sire-movements.service.js';
import { EXPORT_SIRE_FILE } from '../../../../../src/application/use-cases/export-sire-file/ports/in/export-sire-file.port.js';
import { LIST_SIRE_MOVEMENTS } from '../../../../../src/application/use-cases/export-sire-file/ports/in/list-sire-movements.port.js';
import { PREVIEW_SIRE_MOVEMENT } from '../../../../../src/application/use-cases/export-sire-file/ports/in/preview-sire-movement.port.js';
import { PreviewSireMovementService } from '../../../../../src/application/use-cases/export-sire-file/preview-sire-movement.service.js';

/**
 * Lo que ponen `PersistenceModule`, `ClockModule` y `SireConfigModule`, que son globales: no se usan en
 * esta prueba. Los de huéspedes los necesita `ProcessGuestDataModule`, que este módulo importa.
 */
const GLOBALS = [
  SIRE_EXPORT_REPOSITORY,
  SIRE_CONFIG,
  CLOCK,
  RESERVATION_REPOSITORY,
  GUEST_DATA_REPOSITORY,
  MIGRATORY_MOVEMENT_REPOSITORY,
  GUEST_STAY_QUERY,
];

@Global()
@Module({
  providers: GLOBALS.map((token) => ({ provide: token, useValue: {} })),
  exports: GLOBALS,
})
class FakeGlobalModule {}

const INJECTED = Symbol('INJECTED');

describe('ExportSireFileModule (plan base, regla 4)', () => {
  it.each([
    ['EXPORT_SIRE_FILE', EXPORT_SIRE_FILE, ExportSireFileService],
    ['LIST_SIRE_MOVEMENTS', LIST_SIRE_MOVEMENTS, ListSireMovementsService],
    [
      'PREVIEW_SIRE_MOVEMENT',
      PREVIEW_SIRE_MOVEMENT,
      PreviewSireMovementService,
    ],
  ])(
    'exporta %s: SireController lo puede inyectar',
    async (_name, token, service) => {
      const moduleRef = await Test.createTestingModule({
        imports: [FakeGlobalModule, ExportSireFileModule],
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
      await moduleRef.close();
    },
  );
});
