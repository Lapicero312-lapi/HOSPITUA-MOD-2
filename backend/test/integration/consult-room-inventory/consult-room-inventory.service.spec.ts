import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { delay, http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { Room } from '../../../src/application/integration/room.js';
import { ConsultRoomInventoryService } from '../../../src/application/use-cases/consult-room-inventory/consult-room-inventory.service.js';
import {
  CONSULT_ROOM_INVENTORY,
  type ConsultRoomInventory,
} from '../../../src/application/use-cases/consult-room-inventory/ports/in/consult-room-inventory.port.js';
import {
  INVALID_CATEGORY,
  INVALID_ROOM_ID,
  INVENTORY_UNAVAILABLE,
} from '../../../src/domain/shared/error-codes.js';
import { AppConfigModule } from '../../../src/infrastructure/config/app-config.module.js';
import type { EnvironmentVariables } from '../../../src/infrastructure/config/env.validation.js';
import { Module1ClientModule } from '../../../src/infrastructure/out/module1/module1-client.module.js';

/**
 * Pruebas de integración de `consult-room-inventory` (T009): el servicio, el adaptador HTTP y la
 * configuración reales, armados con Nest, contra el Módulo 1 simulado (msw). Las pruebas unitarias del
 * servicio usan un `Module1Port` simulado; estas comprueban que las piezas funcionan juntas.
 */

/**
 * Datos de las pruebas del plan ("Pruebas por escenario", T009), que dice de dónde sale cada uno. El `id`
 * es un UUID cualquiera.
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

const server = setupServer();

/** Las consultas que recibió el Módulo 1 simulado en la prueba: método, ruta y consulta. */
let requests: string[] = [];

describe('ConsultRoomInventory contra el Módulo 1 simulado', () => {
  let moduleRef: TestingModule;
  let inventory: ConsultRoomInventory;
  let roomsUrl: string;
  let timeoutMs: number;

  // Arrancar Nest por primera vez puede tardar más que el tiempo de una prueba: se hace una sola vez.
  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, Module1ClientModule],
      providers: [
        {
          provide: CONSULT_ROOM_INVENTORY,
          useClass: ConsultRoomInventoryService,
        },
      ],
    }).compile();
    inventory = moduleRef.get(CONSULT_ROOM_INVENTORY);

    const config =
      moduleRef.get<ConfigService<EnvironmentVariables, true>>(ConfigService);
    roomsUrl = `${config.get('MODULE1_BASE_URL', { infer: true })}/api/rooms`;
    timeoutMs = config.get('MODULE1_TIMEOUT_MS', { infer: true });

    server.events.on('request:start', ({ request }) => {
      const url = new URL(request.url);
      requests.push(`${request.method} ${url.pathname}${url.search}`);
    });
    server.listen({ onUnhandledRequest: 'error' });
  });

  afterEach(() => {
    server.resetHandlers();
    requests = [];
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    server.close();
    await moduleRef.close();
  });

  /** El Módulo 1 simulado responde `room` a la consulta de esa habitación (A1). */
  function module1RespondsRoom(room: Room): void {
    server.use(
      http.get(`${roomsUrl}/${room.id}`, () => HttpResponse.json(room)),
    );
  }

  /** El Módulo 1 simulado responde `rooms` a la consulta por categoría (A2). */
  function module1RespondsList(rooms: Room[]): void {
    server.use(http.get(roomsUrl, () => HttpResponse.json(rooms)));
  }

  describe('escenarios', () => {
    it('1, consulta puntual: devuelve la habitación tal como la manda el Módulo 1, con una sola consulta GET y ninguna de escritura', async () => {
      module1RespondsRoom(ROOM_201);

      expect(await inventory.byRoomId(ROOM_201.id)).toEqual(ROOM_201);
      expect(requests).toEqual([`GET /api/rooms/${ROOM_201.id}`]);
    });

    it('2, listado por categoría: devuelve todas las habitaciones de la categoría y le pide esa categoryRoom', async () => {
      module1RespondsList([ROOM_201, ROOM_202]);

      expect(await inventory.byCategory('DOBLE')).toEqual([ROOM_201, ROOM_202]);
      expect(requests).toEqual(['GET /api/rooms?categoryRoom=DOBLE']);
    });

    it('3, categoría sin habitaciones: devuelve una lista vacía, sin error', async () => {
      module1RespondsList([]);

      expect(await inventory.byCategory('SUITE_JUNIOR')).toEqual([]);
      expect(requests).toEqual(['GET /api/rooms?categoryRoom=SUITE_JUNIOR']);
    });
  });

  describe('casos borde de error', () => {
    it.each<[string, (port: ConsultRoomInventory) => Promise<unknown>]>([
      ['byRoomId', (port) => port.byRoomId(ROOM_201.id)],
      ['byCategory', (port) => port.byCategory('DOBLE')],
    ])(
      'el Módulo 1 no responde dentro del tiempo máximo (%s): INVENTORY_UNAVAILABLE, sin asumir ninguna habitación',
      async (_, consult) => {
        // El detalle va al log (T007); aquí solo se silencia.
        vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
        // Respuestas válidas, pero tarde: el error solo puede venir del tiempo agotado.
        server.use(
          http.get(`${roomsUrl}/${ROOM_201.id}`, async () => {
            await delay(timeoutMs * 2);
            return HttpResponse.json(ROOM_201);
          }),
          http.get(roomsUrl, async () => {
            await delay(timeoutMs * 2);
            return HttpResponse.json([ROOM_201, ROOM_202]);
          }),
        );

        await expect(consult(inventory)).rejects.toMatchObject({
          errorCode: INVENTORY_UNAVAILABLE.code,
          message: INVENTORY_UNAVAILABLE.message,
        });
      },
    );

    it('un roomId que es un número de habitación (201): INVALID_ROOM_ID, sin llamar al Módulo 1', async () => {
      module1RespondsRoom(ROOM_201);

      await expect(inventory.byRoomId('201')).rejects.toMatchObject({
        errorCode: INVALID_ROOM_ID.code,
        message: INVALID_ROOM_ID.message,
      });
      expect(requests).toEqual([]);
    });

    it('un roomId que el Módulo 1 no conoce (404): INVALID_ROOM_ID', async () => {
      server.use(
        http.get(`${roomsUrl}/${ROOM_201.id}`, () =>
          HttpResponse.json({}, { status: 404 }),
        ),
      );

      await expect(inventory.byRoomId(ROOM_201.id)).rejects.toMatchObject({
        errorCode: INVALID_ROOM_ID.code,
        message: INVALID_ROOM_ID.message,
      });
      expect(requests).toEqual([`GET /api/rooms/${ROOM_201.id}`]);
    });

    it.each([
      ['en minúsculas (doble)', 'doble'],
      ['vacía', ''],
    ])(
      'una categoría %s: INVALID_CATEGORY, sin llamar al Módulo 1',
      async (_, categoryRoom) => {
        module1RespondsList([ROOM_201, ROOM_202]);

        await expect(inventory.byCategory(categoryRoom)).rejects.toMatchObject({
          errorCode: INVALID_CATEGORY.code,
          message: INVALID_CATEGORY.message,
        });
        expect(requests).toEqual([]);
      },
    );
  });
});
