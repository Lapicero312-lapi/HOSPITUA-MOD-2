import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Room } from '../../../src/application/integration/room.js';
import { CLOCK, type Clock } from '../../../src/application/ports/out/clock.js';
import { INVENTORY_UNAVAILABLE } from '../../../src/domain/shared/error-codes.js';
import type { EnvironmentVariables } from '../../../src/infrastructure/config/env.validation.js';
import { configureApp } from '../../../src/configure-app.js';
import { integrationEnv } from '../support/database.js';

/**
 * Pruebas de integración de C1, `GET /api/rooms` (plan de `consult-room-inventory`, T013, D3 y "Pruebas
 * por escenario"): la aplicación completa, con el adaptador HTTP y la configuración reales, contra el
 * Módulo 1 simulado en HTTP (msw). Solo el reloj es fijo, para que la ventana del mantenimiento próximo
 * sea la del ejemplo del plan. La e2e de la ruta reemplaza `Module1Port`; esta pasa por el adaptador.
 */

/**
 * Datos de las pruebas del plan ("Pruebas por escenario", T013): el ejemplo de C1 y la 101 de
 * `SUITE_JUNIOR` de T012. El `id` es un UUID cualquiera.
 */
const ROOM_201: Room = {
  id: randomUUID(),
  roomNumber: '201',
  categoryRoom: 'DOBLE',
  maxCapacity: 2,
};
const ROOM_202: Room = {
  id: randomUUID(),
  roomNumber: '202',
  categoryRoom: 'DOBLE',
  maxCapacity: 3,
};
const ROOM_101: Room = {
  id: randomUUID(),
  roomNumber: '101',
  categoryRoom: 'SUITE_JUNIOR',
  maxCapacity: 2,
};

/** El día del ejemplo de T011: la ventana va del 2026-10-11 al 2026-11-10 (la salida). */
const CLOCK_ON_2026_10_11: Clock = {
  today: () => '2026-10-11',
  now: () => new Date('2026-10-11T15:00:00.000Z'),
};
const WINDOW = '?startDate=2026-10-11&endDate=2026-11-10';

/** El mantenimiento de la 201 del ejemplo de C1, dentro de la ventana. */
const MAINTENANCE_OF_201 = {
  maintenanceStart: '2026-10-20',
  maintenanceEnd: '2026-10-22',
};

const SCHEDULED_201 = { status: 'SCHEDULED', ...MAINTENANCE_OF_201 };
const NONE = { status: 'NONE', maintenanceStart: null, maintenanceEnd: null };
const UNAVAILABLE = {
  status: 'UNAVAILABLE',
  maintenanceStart: null,
  maintenanceEnd: null,
};

/** El 400 de C1 cuando falla el inventario, con el cuerpo de error del plan base. */
const INVENTORY_UNAVAILABLE_BODY = {
  errorCode: INVENTORY_UNAVAILABLE.code,
  message: INVENTORY_UNAVAILABLE.message,
  timestamp: expect.any(String),
  path: '/api/rooms',
};

const server = setupServer();

describe('GET /api/rooms (C1) contra el Módulo 1 simulado', () => {
  let app: INestApplication<App>;
  let module1Origin: string;
  let roomsUrl: string;
  /** Las consultas que recibió el Módulo 1 simulado en la prueba: método, ruta y consulta. */
  let module1Requests: string[] = [];

  // Arrancar la aplicación tarda: se hace una sola vez.
  beforeAll(async () => {
    // AppConfigModule lee el entorno al importarse: AppModule se importa después de asignarlo.
    Object.assign(process.env, { NODE_ENV: 'test', ...integrationEnv() });
    const { AppModule } = await import('../../../src/app.module.js');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CLOCK)
      .useValue(CLOCK_ON_2026_10_11)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();

    const baseUrl = app
      .get<ConfigService<EnvironmentVariables, true>>(ConfigService)
      .get('MODULE1_BASE_URL', { infer: true });
    module1Origin = new URL(baseUrl).origin;
    roomsUrl = `${baseUrl}/api/rooms`;

    server.events.on('request:start', ({ request: sent }) => {
      const url = new URL(sent.url);
      if (url.origin === module1Origin) {
        module1Requests.push(`${sent.method} ${url.pathname}${url.search}`);
      }
    });
    // supertest también sale por HTTP: lo que no va al Módulo 1 pasa sin tocarse. Una consulta al
    // Módulo 1 sin respuesta simulada es un error de la prueba.
    server.listen({
      onUnhandledRequest: (sent, print) => {
        if (new URL(sent.url).origin === module1Origin) {
          print.error();
        }
      },
    });
  });

  afterEach(() => {
    server.resetHandlers();
    module1Requests = [];
  });

  afterAll(async () => {
    server.close();
    await app?.close();
  });

  /**
   * El Módulo 1 simulado: A3 responde `rooms` (o el estado `status`), y el calendario responde con el
   * mantenimiento de la 201 y sin mantenimientos para las demás, salvo la que tenga otro estado en
   * `calendarStatus`.
   */
  function module1Responds({
    rooms,
    status,
    calendarStatus = {},
  }: {
    rooms?: unknown[];
    status?: number;
    calendarStatus?: Record<string, number>;
  }): void {
    server.use(
      http.get(roomsUrl, () =>
        status === undefined
          ? HttpResponse.json(rooms ?? [])
          : new HttpResponse('Servicio no disponible', { status }),
      ),
      http.get(`${roomsUrl}/:roomId/maintenances`, ({ params }) => {
        const roomId = String(params.roomId);
        const failure = calendarStatus[roomId];
        if (failure !== undefined) {
          return new HttpResponse(null, { status: failure });
        }
        return roomId === ROOM_201.id
          ? HttpResponse.json({
              roomId,
              available: false,
              conflicts: [MAINTENANCE_OF_201],
            })
          : HttpResponse.json({ roomId, available: true, conflicts: [] });
      }),
    );
  }

  /** Las consultas de mantenimientos que recibió el Módulo 1, en orden (se hacen en paralelo). */
  const maintenanceRequests = () =>
    module1Requests.filter((sent) => sent.includes('/maintenances')).sort();
  const maintenanceRequestOf = (room: Room) =>
    `GET /api/rooms/${room.id}/maintenances${WINDOW}`;

  describe('éxito', () => {
    it('todas las categorías en orden, con su mantenimiento próximo, sin el estado de la habitación y con el total', async () => {
      // El Módulo 1 las entrega desordenadas, y la 201 con un estado que no es del contrato.
      module1Responds({
        rooms: [ROOM_101, ROOM_202, { ...ROOM_201, status: 'Occupied' }],
      });

      const res = await request(app.getHttpServer())
        .get('/api/rooms')
        .expect(200)
        .expect('Content-Type', /application\/json/);

      expect(res.body).toEqual({
        items: [
          { ...ROOM_201, maintenance: SCHEDULED_201 },
          { ...ROOM_202, maintenance: NONE },
          { ...ROOM_101, maintenance: NONE },
        ],
        total: 3,
      });
    });

    it('el Módulo 1 recibe una sola consulta de A3, sin filtro, y una de mantenimientos por habitación, con la ventana de 30 días', async () => {
      module1Responds({ rooms: [ROOM_201, ROOM_202, ROOM_101] });

      await request(app.getHttpServer()).get('/api/rooms').expect(200);

      expect(
        module1Requests.filter((sent) => !sent.includes('/maintenances')),
      ).toEqual(['GET /api/rooms']);
      expect(maintenanceRequests()).toEqual(
        [ROOM_201, ROOM_202, ROOM_101].map(maintenanceRequestOf).sort(),
      );
    });
  });

  describe('inventario con falla (la "categoría con falla" de la tarea)', () => {
    it.each<[string, Parameters<typeof module1Responds>[0]]>([
      ['A3 responde 503', { status: 503 }],
      [
        'A3 manda una habitación con la categoryRoom mal formada (doble)',
        { rooms: [ROOM_201, { ...ROOM_202, categoryRoom: 'doble' }] },
      ],
    ])(
      '%s: 400 INVENTORY_UNAVAILABLE, sin una lista parcial y sin consultar ningún calendario',
      async (_case, module1) => {
        module1Responds(module1);

        const res = await request(app.getHttpServer())
          .get('/api/rooms')
          .expect(400)
          .expect('Content-Type', /application\/json/);

        expect(res.body).toEqual(INVENTORY_UNAVAILABLE_BODY);
        expect(module1Requests).toEqual(['GET /api/rooms']);
      },
    );
  });

  describe('calendario con falla', () => {
    it.each([503, 404])(
      'si el calendario de la 202 responde %s, esa sale UNAVAILABLE y las demás siguen: 200',
      async (calendarFailure) => {
        module1Responds({
          rooms: [ROOM_201, ROOM_202, ROOM_101],
          calendarStatus: { [ROOM_202.id]: calendarFailure },
        });

        const res = await request(app.getHttpServer())
          .get('/api/rooms')
          .expect(200);

        expect(res.body).toEqual({
          items: [
            { ...ROOM_201, maintenance: SCHEDULED_201 },
            { ...ROOM_202, maintenance: UNAVAILABLE },
            { ...ROOM_101, maintenance: NONE },
          ],
          total: 3,
        });
      },
    );
  });

  describe('sin habitaciones', () => {
    it('A3 responde una lista vacía: 200 con items vacío y total 0, sin consultar ningún calendario', async () => {
      module1Responds({ rooms: [] });

      const res = await request(app.getHttpServer())
        .get('/api/rooms')
        .expect(200);

      expect(res.body).toEqual({ items: [], total: 0 });
      expect(module1Requests).toEqual(['GET /api/rooms']);
    });
  });
});
