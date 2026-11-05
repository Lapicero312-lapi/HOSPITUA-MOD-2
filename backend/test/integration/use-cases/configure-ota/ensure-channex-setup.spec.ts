import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  CHANNEX_PORT,
  type ChannexPort,
} from '../../../../src/application/ports/out/channex.port.js';
import {
  ENSURE_CHANNEX_SETUP,
  type EnsureChannexSetup,
} from '../../../../src/application/use-cases/configure-ota/ports/in/ensure-channex-setup.port.js';
import { integrationEnv, truncateAllTables } from '../../support/database.js';

const PROPERTY_ID = '716305c4-561a-4561-a187-7f5b8aeb5920';

/** Channex simulado: solo A0, con la propiedad configurada. */
const channex = {
  listProperties: vi.fn(() =>
    Promise.resolve([{ id: PROPERTY_ID, title: 'Hotel de prueba' }]),
  ),
} as unknown as ChannexPort;

describe('EnsureChannexSetup con los módulos de Nest y PostgreSQL real', () => {
  let moduleRef: TestingModule;
  let setup: EnsureChannexSetup;
  let dataSource: DataSource;

  beforeAll(async () => {
    // Antes de importar los módulos: AppConfigModule lee el entorno al importarse. La clave es de
    // prueba y Channex está simulado: nunca se llama al real.
    Object.assign(process.env, {
      NODE_ENV: 'test',
      ...integrationEnv(),
      CHANNEX_API_KEY: 'clave-de-prueba',
      CHANNEX_PROPERTY_ID: PROPERTY_ID,
    });
    const { AppConfigModule } =
      await import('../../../../src/infrastructure/config/app-config.module.js');
    const { PersistenceModule } =
      await import('../../../../src/infrastructure/out/persistence/persistence.module.js');
    const { ClockModule } =
      await import('../../../../src/infrastructure/out/clock/clock.module.js');
    const { ChannexClientModule } =
      await import('../../../../src/infrastructure/out/channex/channex-client.module.js');
    const { ConfigureOtaModule } =
      await import('../../../../src/application/use-cases/configure-ota/configure-ota.module.js');
    moduleRef = await Test.createTestingModule({
      imports: [
        AppConfigModule,
        PersistenceModule,
        ClockModule,
        ChannexClientModule,
        ConfigureOtaModule,
      ],
    })
      .overrideProvider(CHANNEX_PORT)
      .useValue(channex)
      .compile();
    moduleRef.useLogger(false);
    await moduleRef.init();
    setup = moduleRef.get(ENSURE_CHANNEX_SETUP);
    dataSource = moduleRef.get(DataSource);
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
  });

  afterAll(async () => {
    await moduleRef?.close();
    delete process.env.CHANNEX_API_KEY;
    delete process.env.CHANNEX_PROPERTY_ID;
  });

  it('con la propiedad verificada registra una sola agencia Booking.com, sin porcentaje, aunque se llame dos veces', async () => {
    await expect(setup.ensure()).resolves.toBe('READY');
    await expect(setup.ensure()).resolves.toBe('READY');

    const rows: {
      name: string;
      commission_percentage: string | null;
      connection_status: string;
    }[] = await dataSource.query(
      'SELECT name, commission_percentage, connection_status FROM ota',
    );
    expect(rows).toEqual([
      {
        name: 'Booking.com',
        commission_percentage: null,
        connection_status: 'CONNECTED',
      },
    ]);
  });
});
