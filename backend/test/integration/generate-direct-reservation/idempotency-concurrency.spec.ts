import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { delay, http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Room } from '../../../src/application/integration/room.js';
import { CLOCK, type Clock } from '../../../src/application/ports/out/clock.js';
import { configureApp } from '../../../src/configure-app.js';
import type { EnvironmentVariables } from '../../../src/infrastructure/config/env.validation.js';
import { integrationEnv, truncateAllTables } from '../support/database.js';

/** La única habitación libre: las dos solicitudes la asignan. */
const ROOM_101: Room = {
  id: '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c01',
  roomNumber: '101',
  categoryRoom: 'DOBLE',
  maxCapacity: 2,
};

const LODGING = '500000.00';

/** Lo que tarda el Módulo 3 en cotizar: las dos solicitudes pasan la consulta de la clave antes de guardar. */
const QUOTE_DELAY_MS = 300;

const clock: Clock = {
  today: () => '2033-03-01',
  now: () => new Date('2033-03-01T15:00:00.000Z'),
};

const BODY = {
  startDate: '2033-03-10',
  endDate: '2033-03-12',
  categoryRoom: 'DOBLE',
  rooms: [{ guestCount: 2 }],
  guest: {
    firstName: 'Valentina',
    lastName: 'Ospina',
    documentType: 'CC',
    documentNumber: '1144093552',
    nationality: 'Colombia',
    contactPhone: '+57 300 000 0000',
    contactEmail: 'valentina@correo.com',
  },
  notes: null,
  expectedRates: [{ position: 1, lodgingAmount: LODGING, currency: 'COP' }],
};

const server = setupServer();

/**
 * Escenario 8 de `generate-direct-reservation` (FR-008, punto 15; T019) con el doble envío **simultáneo**:
 * dos `POST` iguales con la misma `Idempotency-Key` a la vez. Las dos pasan la consulta de la clave sin
 * encontrarla y asignan la misma habitación; la que guarda segunda choca con la restricción anti-solape
 * (o con la clave) antes de guardar la suya. Las dos tienen que responder la misma reserva, y quedar una
 * sola. Con la aplicación completa, PostgreSQL real y los Módulos 1 y 3 simulados en HTTP (msw).
 */
describe('La Idempotency-Key con dos envíos simultáneos (escenario 8, T019)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let quotes = 0;

  const send = (key: string) =>
    request(app.getHttpServer())
      .post('/api/reservations/direct')
      .set('Idempotency-Key', key)
      .send(BODY);

  beforeAll(async () => {
    // AppConfigModule lee el entorno al importarse: AppModule se importa después de asignarlo.
    Object.assign(process.env, { NODE_ENV: 'test', ...integrationEnv() });
    const { AppModule } = await import('../../../src/app.module.js');
    server.listen({ onUnhandledRequest: 'bypass' });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CLOCK)
      .useValue(clock)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    dataSource = app.get(DataSource);
    const config =
      app.get<ConfigService<EnvironmentVariables, true>>(ConfigService);
    const module1Url = config.get('MODULE1_BASE_URL', { infer: true });
    const module3Url = config.get('MODULE3_BASE_URL', { infer: true });
    server.resetHandlers(
      http.get(`${module1Url}/api/rooms`, () => HttpResponse.json([ROOM_101])),
      http.get(`${module1Url}/api/rooms/:roomId`, () =>
        HttpResponse.json(ROOM_101),
      ),
      http.get(`${module1Url}/api/rooms/:roomId/maintenances`, ({ params }) =>
        HttpResponse.json({
          roomId: params.roomId,
          available: true,
          conflicts: [],
        }),
      ),
      http.post(`${module3Url}/pricing/quotes`, async () => {
        quotes += 1;
        const quote = quotes;
        await delay(QUOTE_DELAY_MS);
        return HttpResponse.json({
          quoteId: `00000000-0000-4000-8000-${String(quote).padStart(12, '0')}`,
          currency: 'COP',
          nightlyRates: [],
          lodgingAmount: LODGING,
        });
      }),
    );
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    quotes = 0;
  });

  afterAll(async () => {
    server.close();
    await app?.close();
  });

  it('las dos responden 201 con la misma reserva, y queda una sola reserva y una sola clave', async () => {
    const key = randomUUID();

    const [first, second] = await Promise.all([send(key), send(key)]);

    expect([first.status, second.status]).toEqual([201, 201]);
    expect(first.body.reservationRef).toBe(second.body.reservationRef);
    const [{ reservations }]: { reservations: number }[] =
      await dataSource.query(
        'SELECT count(*)::int AS reservations FROM reservation',
      );
    const [{ keys }]: { keys: number }[] = await dataSource.query(
      'SELECT count(*)::int AS keys FROM idempotency_key',
    );
    expect(reservations).toBe(1);
    expect(keys).toBe(1);
  });

  it('con dos claves distintas por la última habitación, una se crea y la otra no responde la reserva ajena', async () => {
    const [first, second] = await Promise.all([
      send(randomUUID()),
      send(randomUUID()),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 400]);
    const created = first.status === 201 ? first : second;
    const failed = first.status === 201 ? second : first;
    // La perdedora no tiene clave ganadora: su error sale tal cual, no la reserva de la otra.
    expect(failed.body.reservationRef).toBeUndefined();
    expect(failed.body.errorCode).toEqual(expect.any(String));
    expect(created.body.reservationRef).toMatch(/^RSV-/);
  });
});
