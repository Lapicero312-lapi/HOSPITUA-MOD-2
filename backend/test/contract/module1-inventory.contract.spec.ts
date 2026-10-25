import { randomUUID } from 'node:crypto';
import { HttpService } from '@nestjs/axios';
import axios from 'axios';
import { http, HttpResponse, type JsonBodyType } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { validateEnv } from '../../src/infrastructure/config/env.validation.js';
import { Module1HttpAdapter } from '../../src/infrastructure/out/module1/module1-http.adapter.js';

/**
 * Pruebas de contrato de la parte de inventario del adaptador del Módulo 1 (T008): `getRoom` (A1),
 * `listRoomsByCategory` (A2) y `listRooms` (A3). Las de `getMaintenances` están en
 * `module1-maintenance.contract.spec.ts`.
 */

/**
 * Datos de las pruebas del adaptador del plan ("Pruebas por escenario", T008): las habitaciones del
 * ejemplo A2. El `id` es un UUID cualquiera.
 */
const ROOM_201 = {
  id: randomUUID(),
  roomNumber: '201',
  categoryRoom: 'DOBLE',
  maxCapacity: 2,
};
const ROOM_202 = {
  id: randomUUID(),
  roomNumber: '202',
  categoryRoom: 'DOBLE',
  maxCapacity: 3,
};

/** La configuración real: la dirección del Módulo 1 y su tiempo máximo de espera por defecto (1 s). */
const { MODULE1_BASE_URL, MODULE1_TIMEOUT_MS } = validateEnv({});
const ROOMS_URL = `${MODULE1_BASE_URL}/api/rooms`;
const ROOM_201_URL = `${ROOMS_URL}/${ROOM_201.id}`;

const server = setupServer();

/** La consulta (`?…`) que envió el adaptador en la última llamada. */
let requestedQuery: string | null = null;

/** El Módulo 1 simulado responde `body` con el estado `status` en `url`. */
function module1Responds(url: string, body: JsonBodyType, status = 200): void {
  server.use(
    http.get(url, ({ request }) => {
      requestedQuery = new URL(request.url).search;
      return HttpResponse.json(body, { status });
    }),
  );
}

describe('Module1HttpAdapter, inventario, contra el Módulo 1 simulado (contratos A1, A2 y A3)', () => {
  const adapter = new Module1HttpAdapter(
    new HttpService(
      axios.create({ baseURL: MODULE1_BASE_URL, timeout: MODULE1_TIMEOUT_MS }),
    ),
  );

  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => {
    server.resetHandlers();
    requestedQuery = null;
  });
  afterAll(() => server.close());

  describe('éxito', () => {
    it('getRoom (A1): devuelve la habitación con los campos del contrato y descarta los demás', async () => {
      // Un estado del Módulo 1 (plan base, regla 8) que no es del contrato: el inventario no trae
      // estado.
      module1Responds(ROOM_201_URL, { ...ROOM_201, status: 'Occupied' });

      expect(await adapter.getRoom(ROOM_201.id)).toEqual(ROOM_201);
    });

    it('listRoomsByCategory (A2): envía la categoría y devuelve todas sus habitaciones', async () => {
      module1Responds(ROOMS_URL, [ROOM_201, ROOM_202]);

      expect(await adapter.listRoomsByCategory('DOBLE')).toEqual([
        ROOM_201,
        ROOM_202,
      ]);
      expect(requestedQuery).toBe('?categoryRoom=DOBLE');
    });

    it('listRoomsByCategory (A2): una categoría sin habitaciones es una lista vacía, no un error', async () => {
      module1Responds(ROOMS_URL, []);

      expect(await adapter.listRoomsByCategory('SUITE_JUNIOR')).toEqual([]);
      expect(requestedQuery).toBe('?categoryRoom=SUITE_JUNIOR');
    });

    it('listRooms (A3): pide todas, sin filtro, y las devuelve', async () => {
      module1Responds(ROOMS_URL, [ROOM_201, ROOM_202]);

      expect(await adapter.listRooms()).toEqual([ROOM_201, ROOM_202]);
      expect(requestedQuery).toBe('');
    });
  });
});
