import { randomUUID } from 'node:crypto';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SIRE_EXPORT_REPOSITORY } from '../../../src/application/ports/out/sire-export.repository.js';
import {
  SireExport,
  type SireExportProps,
} from '../../../src/domain/migration/sire-export.js';
import { TypeOrmSireExportRepository } from '../../../src/infrastructure/out/persistence/repositories/sire-export.repository.js';
import { TypeOrmTransactionRunner } from '../../../src/infrastructure/out/persistence/typeorm-transaction.js';
import {
  integrationEnv,
  openTestDataSource,
  truncateAllTables,
} from '../support/database.js';

/** La exportación del ejemplo de A del plan de `export-sire-file`: octubre de 2026. */
function aPeriodExport(changes: Partial<SireExportProps> = {}): SireExport {
  return SireExport.restore({
    id: randomUUID(),
    exportDate: new Date('2026-11-01T14:05:00.000Z'),
    exportKind: 'PERIOD',
    recordsCount: 4,
    dateRangeStart: '2026-10-01',
    dateRangeEnd: '2026-10-31',
    processedBy: 'Ana Recepción',
    ...changes,
  });
}

/** Una descarga individual: un registro y sin fechas. */
function aSingleExport(changes: Partial<SireExportProps> = {}): SireExport {
  return aPeriodExport({
    exportKind: 'SINGLE_MOVEMENT',
    recordsCount: 1,
    dateRangeStart: null,
    dateRangeEnd: null,
    ...changes,
  });
}

describe('TypeOrmSireExportRepository contra PostgreSQL real', () => {
  let dataSource: DataSource;
  let exports: TypeOrmSireExportRepository;

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    exports = new TypeOrmSireExportRepository(dataSource);
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it.each([
    ['un periodo', aPeriodExport()],
    ['una descarga individual', aSingleExport()],
  ])(
    'guarda %s y la lee igual, con la hora de la descarga',
    async (_caso, sireExport) => {
      const saved = await exports.insert(sireExport);

      expect(saved.snapshot()).toEqual(sireExport.snapshot());
      expect((await exports.findById(sireExport.id))?.snapshot()).toEqual(
        sireExport.snapshot(),
      );
    },
  );

  it('una descarga que no existe es null', async () => {
    await expect(exports.findById(randomUUID())).resolves.toBeNull();
  });

  it('el mismo periodo dos veces son dos descargas distintas (escenario 4)', async () => {
    const first = await exports.insert(aPeriodExport());
    const second = await exports.insert(aPeriodExport());

    expect(second.id).not.toBe(first.id);
    const [{ count }]: { count: string }[] = await dataSource.query(
      'SELECT count(*) AS count FROM sire_export',
    );
    expect(Number(count)).toBe(2);
  });

  it('dentro de una transacción que se revierte no queda la descarga (regla 7)', async () => {
    const sireExport = aPeriodExport();

    await expect(
      new TypeOrmTransactionRunner(dataSource).run(async (tx) => {
        await exports.insert(sireExport, tx);
        throw new Error('falla después de registrar');
      }),
    ).rejects.toThrow('falla después de registrar');

    await expect(exports.findById(sireExport.id)).resolves.toBeNull();
  });

  describe('las restricciones CHECK de sire_export (plan base)', () => {
    it.each([
      [
        'una descarga individual con más de un registro',
        aSingleExport({ recordsCount: 2 }),
      ],
      [
        'una descarga individual con fechas',
        aSingleExport({
          dateRangeStart: '2026-10-01',
          dateRangeEnd: '2026-10-31',
        }),
      ],
      ['un periodo sin fechas', aPeriodExport({ dateRangeEnd: null })],
      [
        'un periodo con la fecha inicial después de la final',
        aPeriodExport({
          dateRangeStart: '2026-10-31',
          dateRangeEnd: '2026-10-01',
        }),
      ],
      ['una cantidad negativa', aPeriodExport({ recordsCount: -1 })],
    ])('rechazan %s', async (_caso, sireExport) => {
      await expect(exports.insert(sireExport)).rejects.toThrow();
      await expect(exports.findById(sireExport.id)).resolves.toBeNull();
    });
  });
});

/**
 * Un proveedor de fuera de `PersistenceModule` que inyecta el repositorio, como lo hará `ExportSireFile`.
 * `moduleRef.get` encuentra un proveedor aunque el módulo no lo exporte; inyectarlo, no.
 */
const INJECTED_EXPORTS = Symbol('INJECTED_EXPORTS');

describe('PersistenceModule entrega SIRE_EXPORT_REPOSITORY', () => {
  let moduleRef: TestingModule | undefined;

  beforeAll(async () => {
    // Igual que en persistence.module.spec.ts: las variables antes de importar AppConfigModule.
    Object.assign(process.env, { NODE_ENV: 'test', ...integrationEnv() });
    const { AppConfigModule } =
      await import('../../../src/infrastructure/config/app-config.module.js');
    const { PersistenceModule } =
      await import('../../../src/infrastructure/out/persistence/persistence.module.js');
    moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, PersistenceModule],
      providers: [
        {
          provide: INJECTED_EXPORTS,
          inject: [SIRE_EXPORT_REPOSITORY],
          useFactory: (repository: unknown) => repository,
        },
      ],
    }).compile();
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('un caso de uso lo puede inyectar, y es el de TypeORM', () => {
    expect(moduleRef?.get(INJECTED_EXPORTS)).toBeInstanceOf(
      TypeOrmSireExportRepository,
    );
  });
});
