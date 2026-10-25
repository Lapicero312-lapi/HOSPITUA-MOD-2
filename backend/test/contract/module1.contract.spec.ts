import { HttpService } from '@nestjs/axios';
import axios from 'axios';
import { delay, http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  Module1RejectedError,
  Module1RoomNotFoundError,
  Module1UnavailableError,
} from '../../src/application/ports/out/module1.port.js';
import { Module1HttpAdapter } from '../../src/infrastructure/out/module1/module1-http.adapter.js';

const BASE_URL = 'http://module1.test';
const TIMEOUT_MS = 200;
const ROOM_ID = '4a1c7f2e-9b3d-4e8a-a6f1-2c5d8e9b0a13';
const ROOM = {
  id: ROOM_ID,
  roomNumber: '201',
  categoryRoom: 'DOBLE',
  maxCapacity: 2,
};

const server = setupServer();

describe('Module1HttpAdapter contra respuestas simuladas del Módulo 1', () => {
  const adapter = new Module1HttpAdapter(
    new HttpService(axios.create({ baseURL: BASE_URL, timeout: TIMEOUT_MS })),
  );

  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());

  describe('getRoom (A1: GET /api/rooms/{roomId})', () => {
    it('devuelve la habitación con los campos del contrato y descarta los demás', async () => {
      server.use(
        http.get(`${BASE_URL}/api/rooms/${ROOM_ID}`, () =>
          HttpResponse.json({ ...ROOM, status: 'Occupied' }),
        ),
      );

      expect(await adapter.getRoom(ROOM_ID)).toEqual(ROOM);
    });

    it('404 es Module1RoomNotFoundError', async () => {
      server.use(
        http.get(`${BASE_URL}/api/rooms/${ROOM_ID}`, () =>
          HttpResponse.json({}, { status: 404 }),
        ),
      );

      await expect(adapter.getRoom(ROOM_ID)).rejects.toBeInstanceOf(
        Module1RoomNotFoundError,
      );
    });

    it('400 es Module1RejectedError', async () => {
      server.use(
        http.get(`${BASE_URL}/api/rooms/${ROOM_ID}`, () =>
          HttpResponse.json({}, { status: 400 }),
        ),
      );

      await expect(adapter.getRoom(ROOM_ID)).rejects.toBeInstanceOf(
        Module1RejectedError,
      );
    });

    it.each([
      ['maxCapacity no entero', { ...ROOM, maxCapacity: 1.5 }],
      ['maxCapacity menor que 1', { ...ROOM, maxCapacity: 0 }],
      ['sin roomNumber', { ...ROOM, roomNumber: undefined }],
      ['categoryRoom vacía', { ...ROOM, categoryRoom: '' }],
      ['una lista en lugar de un objeto', [ROOM]],
    ])('una respuesta %s es Module1UnavailableError', async (_, body) => {
      server.use(
        http.get(`${BASE_URL}/api/rooms/${ROOM_ID}`, () =>
          HttpResponse.json(body),
        ),
      );

      await expect(adapter.getRoom(ROOM_ID)).rejects.toBeInstanceOf(
        Module1UnavailableError,
      );
    });
  });

  describe('listRoomsByCategory y listRooms (A2 y A3: GET /api/rooms)', () => {
    it('envía la categoría y devuelve todas las habitaciones, sin filtrar por estado', async () => {
      let requestedCategory: string | null = null;
      server.use(
        http.get(`${BASE_URL}/api/rooms`, ({ request }) => {
          requestedCategory = new URL(request.url).searchParams.get(
            'categoryRoom',
          );
          return HttpResponse.json([ROOM, { ...ROOM, roomNumber: '202' }]);
        }),
      );

      const rooms = await adapter.listRoomsByCategory('DOBLE');

      expect(requestedCategory).toBe('DOBLE');
      expect(rooms.map((room) => room.roomNumber)).toEqual(['201', '202']);
    });

    it('una categoría sin habitaciones es una lista vacía, no un error', async () => {
      server.use(
        http.get(`${BASE_URL}/api/rooms`, () => HttpResponse.json([])),
      );

      expect(await adapter.listRoomsByCategory('SUITE')).toEqual([]);
    });

    it('listRooms pide todas, sin filtro', async () => {
      let query = 'sin consultar';
      server.use(
        http.get(`${BASE_URL}/api/rooms`, ({ request }) => {
          query = new URL(request.url).search;
          return HttpResponse.json([ROOM]);
        }),
      );

      expect(await adapter.listRooms()).toEqual([ROOM]);
      expect(query).toBe('');
    });

    it('una lista con una habitación mal formada es Module1UnavailableError', async () => {
      server.use(
        http.get(`${BASE_URL}/api/rooms`, () =>
          HttpResponse.json([ROOM, { ...ROOM, maxCapacity: 'dos' }]),
        ),
      );

      await expect(adapter.listRooms()).rejects.toBeInstanceOf(
        Module1UnavailableError,
      );
    });
  });

  describe('fallos del Módulo 1: nunca se asume la respuesta', () => {
    it.each([500, 502, 503, 302])(
      'un %s es Module1UnavailableError',
      async (status) => {
        server.use(
          http.get(
            `${BASE_URL}/api/rooms`,
            () => new HttpResponse(null, { status }),
          ),
        );

        await expect(adapter.listRooms()).rejects.toBeInstanceOf(
          Module1UnavailableError,
        );
      },
    );

    it('si no responde en el tiempo máximo es Module1UnavailableError', async () => {
      server.use(
        http.get(`${BASE_URL}/api/rooms`, async () => {
          await delay(TIMEOUT_MS * 3);
          return HttpResponse.json([]);
        }),
      );

      await expect(adapter.listRooms()).rejects.toThrow(
        'tiempo de espera agotado',
      );
    });

    it('sin conexión es Module1UnavailableError', async () => {
      server.use(http.get(`${BASE_URL}/api/rooms`, () => HttpResponse.error()));

      await expect(adapter.listRooms()).rejects.toBeInstanceOf(
        Module1UnavailableError,
      );
    });

    it('un cuerpo que no es JSON es Module1UnavailableError', async () => {
      server.use(
        http.get(`${BASE_URL}/api/rooms`, () => HttpResponse.text('<html>')),
      );

      await expect(adapter.listRooms()).rejects.toThrow('no es JSON');
    });
  });
});
