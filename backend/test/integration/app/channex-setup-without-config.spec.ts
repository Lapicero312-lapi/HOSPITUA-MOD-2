import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  CHANNEX_PORT,
  type ChannexPort,
} from '../../../src/application/ports/out/channex.port.js';
import type { ChannexVerification } from '../../../src/application/use-cases/configure-ota/ports/in/verify-channex-property.port.js';
import { configureApp } from '../../../src/configure-app.js';
import { ChannexSetupJob } from '../../../src/infrastructure/in/jobs/channex-setup.job.js';
import { captureLogs } from '../support/capture-logs.js';
import {
  integrationEnv,
  openTestDataSource,
  truncateAllTables,
} from '../support/database.js';

/**
 * Escenario 3 de la historia 1 de `configure-ota` con la configuración incompleta: sin la clave ni la
 * propiedad. Va en su propio archivo porque `AppConfigModule` lee el entorno una sola vez, al importarse.
 */
describe('Al arrancar sin la configuración de Channex (configure-ota, escenario 3)', () => {
  let dataSource: DataSource;
  let app: INestApplication<App>;
  let logs: string[];
  let result: ChannexVerification;
  const channex = {
    listProperties: vi.fn(),
    listRoomTypes: vi.fn(),
    createRoomType: vi.fn(),
    updateRoomType: vi.fn(),
    pushAvailability: vi.fn(),
    fetchBookingFeed: vi.fn(),
    ackBookingRevision: vi.fn(),
    reportNoShow: vi.fn(),
  } satisfies Record<keyof ChannexPort, unknown>;

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    await truncateAllTables(dataSource);
    // Vacías a propósito, por encima de cualquier `.env`: la configuración queda incompleta.
    Object.assign(process.env, {
      NODE_ENV: 'test',
      ...integrationEnv(),
      CHANNEX_API_KEY: '',
      CHANNEX_PROPERTY_ID: '',
    });
    logs = captureLogs();
    const attempt = vi.spyOn(ChannexSetupJob.prototype, 'attempt');
    const { AppModule } = await import('../../../src/app.module.js');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CHANNEX_PORT)
      .useValue(channex)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    result = await (attempt.mock.results[0]
      .value as Promise<ChannexVerification>);
  });

  afterAll(async () => {
    await app?.close();
    vi.restoreAllMocks();
    await dataSource?.destroy();
    delete process.env.CHANNEX_API_KEY;
    delete process.env.CHANNEX_PROPERTY_ID;
  });

  it('registra el error nombrando las variables, sin sus valores', () => {
    expect(logs).toContainEqual(
      expect.stringMatching(
        /Configuración de Channex incompleta o inválida \(.*CHANNEX_API_KEY.*CHANNEX_PROPERTY_ID.*\)/,
      ),
    );
  });

  it('deja apagadas las tareas de Channex y no le envía nada', () => {
    expect(result).toBe('DISABLED');
    for (const method of Object.values(channex)) {
      expect(method).not.toHaveBeenCalled();
    }
  });

  it('no registra la agencia', async () => {
    expect(await dataSource.query('SELECT name FROM ota')).toEqual([]);
  });

  it('el resto del Módulo 2 funciona: responde la documentación de la API', async () => {
    await request(app.getHttpServer()).get('/api/docs-json').expect(200);
  });
});
