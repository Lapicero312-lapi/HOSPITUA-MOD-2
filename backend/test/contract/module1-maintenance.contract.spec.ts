import { randomUUID } from 'node:crypto';
import { HttpService } from '@nestjs/axios';
import axios from 'axios';
import { delay, http, HttpResponse, type JsonBodyType } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  Module1RejectedError,
  Module1RoomNotFoundError,
  Module1UnavailableError,
} from '../../src/application/ports/out/module1.port.js';
import { validateEnv } from '../../src/infrastructure/config/env.validation.js';
import { Module1HttpAdapter } from '../../src/infrastructure/out/module1/module1-http.adapter.js';

/**
 * Pruebas de contrato de `getMaintenances` (T010). Las pruebas de contrato de `getRoom`, las listas y los
 * fallos generales del mismo adaptador están en `module1.contract.spec.ts`.
 */

/**
 * Datos de las pruebas del adaptador del plan ("Pruebas por escenario", T010): la estadía del ejemplo del
 * plan y las respuestas del contrato A1. El `roomId` es un UUID cualquiera.
 */
const ROOM_ID = randomUUID();
const START_DATE = '2026-10-11';
const END_DATE = '2026-10-14';

/** La configuración real: la dirección del Módulo 1 y su tiempo máximo de espera por defecto (1 s). */
const { MODULE1_BASE_URL, MODULE1_TIMEOUT_MS } = validateEnv({});
const MAINTENANCES_URL = `${MODULE1_BASE_URL}/api/rooms/${ROOM_ID}/maintenances`;

const server = setupServer();

/** Las fechas que pidió el adaptador en la última consulta. */
let requestedDates: Record<string, string> = {};

/** El Módulo 1 simulado responde `body` con el estado `status`. */
function module1Responds(body: JsonBodyType, status = 200): void {
  server.use(
    http.get(MAINTENANCES_URL, ({ request }) => {
      requestedDates = Object.fromEntries(new URL(request.url).searchParams);
      return HttpResponse.json(body, { status });
    }),
  );
}

describe('Module1HttpAdapter.getMaintenances contra el Módulo 1 simulado (contrato A1)', () => {
  const adapter = new Module1HttpAdapter(
    new HttpService(
      axios.create({ baseURL: MODULE1_BASE_URL, timeout: MODULE1_TIMEOUT_MS }),
    ),
  );
  const getMaintenances = () =>
    adapter.getMaintenances(ROOM_ID, START_DATE, END_DATE);

  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => {
    server.resetHandlers();
    requestedDates = {};
  });
  afterAll(() => server.close());

  describe('respuestas del contrato', () => {
    it('sin cruce: devuelve available true sin mantenimientos y pide las fechas de la estadía', async () => {
      const response = { roomId: ROOM_ID, available: true, conflicts: [] };
      module1Responds(response);

      expect(await getMaintenances()).toEqual(response);
      expect(requestedDates).toEqual({
        startDate: START_DATE,
        endDate: END_DATE,
      });
    });

    it('con un cruce: devuelve el mantenimiento que se cruza', async () => {
      const response = {
        roomId: ROOM_ID,
        available: false,
        conflicts: [
          { maintenanceStart: '2026-10-10', maintenanceEnd: '2026-10-12' },
        ],
      };
      module1Responds(response);

      expect(await getMaintenances()).toEqual(response);
    });

    it('con varios cruces: devuelve todos los mantenimientos que se cruzan', async () => {
      const response = {
        roomId: ROOM_ID,
        available: false,
        conflicts: [
          { maintenanceStart: '2026-10-10', maintenanceEnd: '2026-10-12' },
          { maintenanceStart: '2026-10-13', maintenanceEnd: '2026-10-13' },
        ],
      };
      module1Responds(response);

      expect(await getMaintenances()).toEqual(response);
    });

    it('contiguo: con un mantenimiento que termina justo antes de la llegada, el Módulo 1 responde sin cruce y se devuelve igual', async () => {
      // El mantenimiento termina el 2026-10-10 y la estadía empieza el 2026-10-11: el Módulo 1 decide que no cruza.
      const response = { roomId: ROOM_ID, available: true, conflicts: [] };
      module1Responds(response);

      expect(await getMaintenances()).toEqual(response);
      expect(requestedDates).toEqual({
        startDate: START_DATE,
        endDate: END_DATE,
      });
    });
  });

  describe('errores del Módulo 1', () => {
    it('404 (la habitación no existe) es Module1RoomNotFoundError', async () => {
      module1Responds({}, 404);

      await expect(getMaintenances()).rejects.toBeInstanceOf(
        Module1RoomNotFoundError,
      );
    });

    it('400 (rechaza la consulta) es Module1RejectedError', async () => {
      module1Responds({}, 400);

      await expect(getMaintenances()).rejects.toBeInstanceOf(
        Module1RejectedError,
      );
    });

    it('503 es Module1UnavailableError: no se asume la respuesta', async () => {
      module1Responds({}, 503);

      await expect(getMaintenances()).rejects.toThrow(
        new Module1UnavailableError('respondió 503'),
      );
    });

    it('si no responde dentro del tiempo máximo (1 s) es Module1UnavailableError', async () => {
      server.use(
        http.get(MAINTENANCES_URL, async () => {
          await delay(MODULE1_TIMEOUT_MS * 2);
          return HttpResponse.json({
            roomId: ROOM_ID,
            available: true,
            conflicts: [],
          });
        }),
      );

      await expect(getMaintenances()).rejects.toThrow(
        new Module1UnavailableError('tiempo de espera agotado'),
      );
    });
  });

  describe('respuestas mal formadas: Module1UnavailableError', () => {
    it.each<[string, JsonBodyType]>([
      ['sin available', { roomId: ROOM_ID, conflicts: [] }],
      [
        'con conflicts que no es una lista',
        { roomId: ROOM_ID, available: false, conflicts: 'ninguno' },
      ],
      [
        'con una fecha inexistente',
        {
          roomId: ROOM_ID,
          available: false,
          conflicts: [
            { maintenanceStart: '2026-02-30', maintenanceEnd: '2026-10-12' },
          ],
        },
      ],
      [
        'con una fecha mal formada',
        {
          roomId: ROOM_ID,
          available: false,
          conflicts: [
            { maintenanceStart: '2026-10-10', maintenanceEnd: '14/10/2026' },
          ],
        },
      ],
      [
        'con un mantenimiento que termina antes de empezar',
        {
          roomId: ROOM_ID,
          available: false,
          conflicts: [
            { maintenanceStart: '2026-10-12', maintenanceEnd: '2026-10-10' },
          ],
        },
      ],
    ])('una respuesta %s', async (_, body) => {
      module1Responds(body);

      await expect(getMaintenances()).rejects.toThrow(
        new Module1UnavailableError('respuesta distinta del contrato'),
      );
    });

    it('un cuerpo que no es JSON', async () => {
      server.use(http.get(MAINTENANCES_URL, () => HttpResponse.text('<html>')));

      await expect(getMaintenances()).rejects.toThrow(
        new Module1UnavailableError('la respuesta no es JSON'),
      );
    });
  });
});
