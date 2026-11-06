import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { DataSource } from 'typeorm';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest';
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

const PROPERTY_ID = '716305c4-561a-4561-a187-7f5b8aeb5920';
const LINKED_AT = new Date('2026-03-02T14:14:00.000Z');

type FakeChannex = Record<keyof ChannexPort, Mock>;

/** Channex simulado: A0 devuelve `properties`; nada más debería llamarse al arrancar. */
function fakeChannex(properties: { id: string; title: string }[]): FakeChannex {
  return {
    listProperties: vi.fn(() => Promise.resolve(properties)),
    listRoomTypes: vi.fn(),
    createRoomType: vi.fn(),
    updateRoomType: vi.fn(),
    pushAvailability: vi.fn(),
    fetchBookingFeed: vi.fn(),
    ackBookingRevision: vi.fn(),
    reportNoShow: vi.fn(),
  };
}

/** Las llamadas a Channex distintas de A0 (`listProperties`). */
function callsBesidesA0(channex: FakeChannex): number {
  return Object.entries(channex)
    .filter(([method]) => method !== 'listProperties')
    .reduce((total, [, mock]) => total + mock.mock.calls.length, 0);
}

/**
 * Los escenarios de la historia 1 de `configure-ota` (spec, escenarios 2 y 3; el 1 lo prueba
 * `channex-setup-at-startup.spec.ts`), con la aplicación completa, PostgreSQL real y Channex simulado.
 */
describe('Configuración de Channex al arrancar (configure-ota, historia 1)', () => {
  let dataSource: DataSource;
  let app: INestApplication<App> | undefined;
  let logs: string[];

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    // Antes de importar AppModule: AppConfigModule lee el entorno al importarse. La clave es de prueba y
    // Channex está simulado: nunca se llama al real.
    Object.assign(process.env, {
      NODE_ENV: 'test',
      ...integrationEnv(),
      CHANNEX_API_KEY: 'clave-de-prueba',
      CHANNEX_PROPERTY_ID: PROPERTY_ID,
    });
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    logs = captureLogs();
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await truncateAllTables(dataSource);
    await dataSource.destroy();
    delete process.env.CHANNEX_API_KEY;
    delete process.env.CHANNEX_PROPERTY_ID;
  });

  /** Arranca la aplicación y espera a que termine el primer intento de `ChannexSetupJob`. */
  async function start(channex: FakeChannex): Promise<ChannexVerification> {
    const attempt = vi.spyOn(ChannexSetupJob.prototype, 'attempt');
    const { AppModule } = await import('../../../src/app.module.js');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CHANNEX_PORT)
      .useValue(channex)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    expect(attempt).toHaveBeenCalledTimes(1);
    return attempt.mock.results[0].value as Promise<ChannexVerification>;
  }

  /** Las agencias guardadas; `linked_at` llega como texto y se compara como fecha. */
  async function agencies(): Promise<
    { name: string; commission_percentage: string | null; linked_at: Date }[]
  > {
    const rows: {
      name: string;
      commission_percentage: string | null;
      linked_at: string;
    }[] = await dataSource.query(
      'SELECT name, commission_percentage, linked_at FROM ota',
    );
    return rows.map((row) => ({ ...row, linked_at: new Date(row.linked_at) }));
  }

  it.each([
    ['con porcentaje', '15.00'],
    ['sin porcentaje', null],
  ])(
    'escenario 2: al reiniciar, con la agencia ya registrada %s, no crea otra y conserva su porcentaje',
    async (_, percentage) => {
      await dataSource.query(
        `INSERT INTO ota (name, commission_percentage, connection_status, linked_at, last_sync_at)
         VALUES ('Booking.com', $1, 'CONNECTED', $2, $2)`,
        [percentage, LINKED_AT],
      );
      const channex = fakeChannex([
        { id: PROPERTY_ID, title: 'Hotel de prueba' },
      ]);

      expect(await start(channex)).toBe('READY');

      expect(await agencies()).toEqual([
        {
          name: 'Booking.com',
          commission_percentage: percentage,
          linked_at: LINKED_AT,
        },
      ]);
      expect(channex.listProperties).toHaveBeenCalledTimes(1);
    },
  );

  it('escenario 3: con una propiedad que no existe en Channex registra el error, no envía nada más y el resto funciona', async () => {
    const channex = fakeChannex([
      { id: 'b2f1c0de-0000-4000-8000-000000000000', title: 'Otro hotel' },
    ]);

    expect(await start(channex)).toBe('DISABLED');

    expect(channex.listProperties).toHaveBeenCalledTimes(1);
    expect(callsBesidesA0(channex)).toBe(0);
    expect(await agencies()).toEqual([]);
    expect(logs).toContainEqual(
      expect.stringContaining(
        'La propiedad configurada (CHANNEX_PROPERTY_ID) no existe en Channex',
      ),
    );
    await request(app!.getHttpServer()).get('/api/docs-json').expect(200);
  });
});
