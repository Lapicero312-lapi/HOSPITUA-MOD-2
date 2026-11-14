import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AriChange } from '../../../../src/application/ports/out/ari-pending-change.repository.js';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../../src/application/ports/out/transaction.js';
import { AriChangeRecorderService } from '../../../../src/application/use-cases/configure-ota/ari-change-recorder.service.js';
import {
  ARI_CHANGE_RECORDER,
  type AriChangeRecorder,
} from '../../../../src/application/use-cases/configure-ota/ports/in/ari-change-recorder.port.js';
import { integrationEnv, truncateAllTables } from '../../support/database.js';

/** Un proveedor de fuera de `ConfigureOtaModule` lo inyecta, como lo harán los casos de uso (regla 6). */
const INJECTED_RECORDER = Symbol('INJECTED_RECORDER');

/** El rango del ejemplo de A4 del plan de `configure-ota`: una noche, la del 10 de noviembre. */
const DOBLE_ONE_NIGHT: AriChange = {
  categoryRoom: 'DOBLE',
  dateFrom: '2026-11-10',
  dateTo: '2026-11-11',
};

describe('AriChangeRecorder con los módulos de Nest y PostgreSQL real (configure-ota, T009)', () => {
  let moduleRef: TestingModule;
  let recorder: AriChangeRecorder;
  let transactions: TransactionRunner;
  let dataSource: DataSource;

  const pending = () =>
    dataSource.query<
      { category_room: string; date_from: string; date_to: string }[]
    >(
      `SELECT category_room, date_from::text, date_to::text
       FROM ari_pending_change ORDER BY created_at, category_room`,
    );

  beforeAll(async () => {
    // AppConfigModule lee el entorno al importarse: se importa después de asignarlo.
    Object.assign(process.env, { NODE_ENV: 'test', ...integrationEnv() });
    const { AppConfigModule } =
      await import('../../../../src/infrastructure/config/app-config.module.js');
    const { PersistenceModule } =
      await import('../../../../src/infrastructure/out/persistence/persistence.module.js');
    const { ClockModule } =
      await import('../../../../src/infrastructure/out/clock/clock.module.js');
    const { ChannexClientModule } =
      await import('../../../../src/infrastructure/out/channex/channex-client.module.js');
    const { Module1ClientModule } =
      await import('../../../../src/infrastructure/out/module1/module1-client.module.js');
    const { ConfigureOtaModule } =
      await import('../../../../src/application/use-cases/configure-ota/configure-ota.module.js');
    moduleRef = await Test.createTestingModule({
      imports: [
        AppConfigModule,
        PersistenceModule,
        ClockModule,
        ChannexClientModule,
        Module1ClientModule,
        ConfigureOtaModule,
      ],
      providers: [
        {
          provide: INJECTED_RECORDER,
          inject: [ARI_CHANGE_RECORDER],
          useFactory: (injected: unknown) => injected,
        },
      ],
    }).compile();
    moduleRef.useLogger(false);
    recorder = moduleRef.get(INJECTED_RECORDER);
    transactions = moduleRef.get(TRANSACTION_RUNNER);
    dataSource = moduleRef.get(DataSource);
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('ConfigureOtaModule lo exporta: un caso de uso de fuera lo puede inyectar', () => {
    expect(recorder).toBeInstanceOf(AriChangeRecorderService);
  });

  it('deja una marca por categoría y rango, en la transacción del cambio', async () => {
    await transactions.run((tx) =>
      recorder.record(tx, [
        DOBLE_ONE_NIGHT,
        { categoryRoom: 'SUITE', dateFrom: '2026-11-12', dateTo: '2026-11-15' },
      ]),
    );

    expect(await pending()).toEqual([
      {
        category_room: 'DOBLE',
        date_from: '2026-11-10',
        date_to: '2026-11-11',
      },
      {
        category_room: 'SUITE',
        date_from: '2026-11-12',
        date_to: '2026-11-15',
      },
    ]);
  });

  it('si la transacción del cambio se revierte, las marcas no quedan', async () => {
    await expect(
      transactions.run(async (tx) => {
        await recorder.record(tx, [DOBLE_ONE_NIGHT]);
        throw new Error('falla la reserva');
      }),
    ).rejects.toThrow('falla la reserva');

    expect(await pending()).toEqual([]);
  });

  it('sin cambios, no deja nada', async () => {
    await transactions.run((tx) => recorder.record(tx, []));

    expect(await pending()).toEqual([]);
  });
});
