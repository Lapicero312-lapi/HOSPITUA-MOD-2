import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  CHANNEX_PORT,
  type ChannexPort,
} from '../../../src/application/ports/out/channex.port.js';
import {
  integrationEnv,
  openTestDataSource,
  truncateAllTables,
} from '../support/database.js';

const PROPERTY_ID = '716305c4-561a-4561-a187-7f5b8aeb5920';

/** Channex simulado: solo A0, con la propiedad configurada. */
const listProperties = vi.fn(() =>
  Promise.resolve([{ id: PROPERTY_ID, title: 'Hotel de prueba' }]),
);
const channex = { listProperties } as unknown as ChannexPort;

/**
 * La aplicación completa (`AppModule`) con PostgreSQL real y Channex simulado: comprueba que
 * `ChannexSetupJob` está conectado al arranque (en `JobsModule`, que importa `AppModule`) y que deja
 * registrada la agencia Booking.com.
 */
describe('Al arrancar la aplicación con Channex configurado', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    await truncateAllTables(dataSource);
    // Antes de importar AppModule: AppConfigModule lee el entorno al importarse. La clave es de prueba y
    // Channex está simulado: nunca se llama al real.
    Object.assign(process.env, {
      NODE_ENV: 'test',
      ...integrationEnv(),
      CHANNEX_API_KEY: 'clave-de-prueba',
      CHANNEX_PROPERTY_ID: PROPERTY_ID,
    });
    const { AppModule } = await import('../../../src/app.module.js');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CHANNEX_PORT)
      .useValue(channex)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await dataSource?.destroy();
    delete process.env.CHANNEX_API_KEY;
    delete process.env.CHANNEX_PROPERTY_ID;
  });

  it('verifica la propiedad y registra una sola agencia Booking.com, sin porcentaje y en CONNECTED', async () => {
    await vi.waitFor(
      async () => {
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
      },
      { timeout: 10_000, interval: 100 },
    );
    expect(listProperties).toHaveBeenCalledTimes(1);
  });
});
