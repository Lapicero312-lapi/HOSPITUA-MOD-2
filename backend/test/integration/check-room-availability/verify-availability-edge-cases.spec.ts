import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { delay, http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { DataSource } from 'typeorm';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import {
  VERIFY_AVAILABILITY,
  type VerifyAvailability,
} from '../../../src/application/use-cases/check-room-availability/ports/in/verify-availability.port.js';
import { BusinessError } from '../../../src/domain/shared/business-error.js';
import type { EnvironmentVariables } from '../../../src/infrastructure/config/env.validation.js';
import { TypeOrmReservationRepository } from '../../../src/infrastructure/out/persistence/repositories/reservation.repository.js';
import { aDirectReservation, aDirectRoom } from '../../support/builders.js';
import { ROOM_201, ROOM_202 } from '../../support/rooms.js';
import { checkRoomAvailabilityModules } from '../support/check-room-availability.js';
import { truncateAllTables } from '../support/database.js';

/**
 * T013 de `check-room-availability`: los casos borde del spec (Módulo 1 sin responder, fechas inválidas,
 * `roomId` inválido y verificaciones simultáneas). Todo es real salvo el Módulo 1, que se simula en HTTP
 * (msw): los módulos de Nest, el adaptador HTTP con su tiempo máximo (`MODULE1_TIMEOUT_MS`), la
 * configuración y PostgreSQL. Cada error es un `BusinessError`, que el filtro global responde con 400, con
 * el mensaje literal de la tabla de errores del plan.
 */

/** La estadía del ejemplo del DTO del plan (dos noches). */
const START = '2026-10-10';
const END = '2026-10-12';

/** Los mensajes de la tabla de errores del plan, escritos aquí tal cual. */
const MESSAGES = {
  MAINTENANCE_CHECK_UNAVAILABLE:
    'No es posible validar mantenimientos en este momento. Intente de nuevo.',
  INVENTORY_UNAVAILABLE:
    'No se pudo consultar el inventario de habitaciones en este momento. Intente de nuevo.',
  INVALID_STAY_DATES:
    'Rango de fechas inválido. Verifique las fechas seleccionadas.',
  INVALID_ROOM_ID: 'El identificador de la habitación es inválido.',
} as const;

const server = setupServer();

describe('VerifyAvailability: casos borde (T013)', () => {
  let moduleRef: TestingModule;
  let availability: VerifyAvailability;
  let dataSource: DataSource;
  let baseUrl: string;
  let timeoutMs: number;
  /** Las rutas del Módulo 1 que recibieron una consulta durante la prueba. */
  let module1Requests: string[] = [];

  const free = (roomId: string) =>
    HttpResponse.json({ roomId, available: true, conflicts: [] });

  /**
   * El Módulo 1 simulado: la 201 y la 202 en el inventario (404 para cualquier otra habitación) y, por
   * habitación, el calendario que indica la prueba; si no indica ninguno, sin mantenimientos.
   */
  function module1Answering(
    calendar: (roomId: string) => Response | Promise<Response> = free,
  ): void {
    server.use(
      http.get(`${baseUrl}/api/rooms`, () =>
        HttpResponse.json([ROOM_201, ROOM_202]),
      ),
      http.get(`${baseUrl}/api/rooms/:roomId`, ({ params }) => {
        const room = [ROOM_201, ROOM_202].find(
          (candidate) => candidate.id === params.roomId,
        );
        return room
          ? HttpResponse.json(room)
          : new HttpResponse(null, { status: 404 });
      }),
      http.get(`${baseUrl}/api/rooms/:roomId/maintenances`, ({ params }) =>
        calendar(String(params.roomId)),
      ),
    );
  }

  const checkCategory = (startDate = START, endDate = END) =>
    availability.check({ startDate, endDate, categoryRoom: 'DOBLE' });

  const checkRoom = (roomId: string, startDate = START, endDate = END) =>
    availability.check({ startDate, endDate, roomId });

  /** La verificación falla con un `BusinessError` (400) de ese código y con su mensaje literal. */
  async function expectRejectedWith(
    verification: Promise<unknown>,
    errorCode: keyof typeof MESSAGES,
  ): Promise<void> {
    await expect(verification).rejects.toBeInstanceOf(BusinessError);
    await expect(verification).rejects.toMatchObject({
      errorCode,
      message: MESSAGES[errorCode],
    });
  }

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: await checkRoomAvailabilityModules(),
    }).compile();
    availability = moduleRef.get<VerifyAvailability>(VERIFY_AVAILABILITY);
    dataSource = moduleRef.get(DataSource);
    const config =
      moduleRef.get<ConfigService<EnvironmentVariables, true>>(ConfigService);
    baseUrl = config.get('MODULE1_BASE_URL', { infer: true });
    timeoutMs = config.get('MODULE1_TIMEOUT_MS', { infer: true });
    server.events.on('request:start', ({ request }) => {
      module1Requests.push(new URL(request.url).pathname);
    });
    server.listen({ onUnhandledRequest: 'error' });
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    module1Requests = [];
  });

  afterEach(() => {
    server.resetHandlers();
  });

  afterAll(async () => {
    server.close();
    await moduleRef?.close();
  });

  describe('Módulo 1 sin responder', () => {
    it('el calendario de la 201 no responde a tiempo y el de la 202 la da libre: falla toda la verificación con MAINTENANCE_CHECK_UNAVAILABLE, sin asumir disponibilidad', async () => {
      module1Answering(async (roomId) => {
        if (roomId === ROOM_201.id) {
          await delay(timeoutMs + 500);
        }
        return free(roomId);
      });

      await expectRejectedWith(
        checkCategory(),
        'MAINTENANCE_CHECK_UNAVAILABLE',
      );
      // La 202 se consultó y respondió libre, y aun así no se devuelve: no hay resultado.
      expect(module1Requests).toContain(
        `/api/rooms/${ROOM_202.id}/maintenances`,
      );
    });

    it('el inventario no responde a tiempo: INVENTORY_UNAVAILABLE, sin consultar el calendario', async () => {
      module1Answering();
      server.use(
        http.get(`${baseUrl}/api/rooms`, async () => {
          await delay(timeoutMs + 500);
          return HttpResponse.json([ROOM_201, ROOM_202]);
        }),
      );

      await expectRejectedWith(checkCategory(), 'INVENTORY_UNAVAILABLE');
      expect(module1Requests).toEqual(['/api/rooms']);
    });
  });

  describe('Fechas inválidas', () => {
    it.each([
      ['por categoría', () => checkCategory(END, START)],
      ['por roomId', () => checkRoom(ROOM_201.id, END, START)],
    ])(
      'la salida antes de la llegada, %s: INVALID_STAY_DATES, sin llamar al Módulo 1',
      async (_, verify) => {
        module1Answering();

        await expectRejectedWith(verify(), 'INVALID_STAY_DATES');
        expect(module1Requests).toEqual([]);
      },
    );
  });

  describe('roomId inválido', () => {
    it('un número de habitación (201) en lugar de un UUID: INVALID_ROOM_ID, sin llamar al Módulo 1', async () => {
      module1Answering();

      await expectRejectedWith(checkRoom('201'), 'INVALID_ROOM_ID');
      expect(module1Requests).toEqual([]);
    });

    it('una habitación que el Módulo 1 no conoce (404): INVALID_ROOM_ID, sin consultar el calendario', async () => {
      module1Answering();
      const unknownRoomId = randomUUID();

      await expectRejectedWith(checkRoom(unknownRoomId), 'INVALID_ROOM_ID');
      expect(module1Requests).toEqual([`/api/rooms/${unknownRoomId}`]);
    });
  });

  describe('Verificaciones simultáneas', () => {
    it('dos verificaciones de la 201 a la vez responden las dos disponible: la verificación no bloquea la habitación', async () => {
      // El calendario responde solo cuando le llegaron las dos consultas: las dos verificaciones están en
      // curso a la vez. Si una esperara a la otra, la primera agotaría el tiempo del Módulo 1.
      let calendarRequests = 0;
      let releaseCalendar = () => {};
      const bothRequested = new Promise<void>((resolve) => {
        releaseCalendar = resolve;
      });
      module1Answering(async (roomId) => {
        calendarRequests += 1;
        if (calendarRequests === 2) {
          releaseCalendar();
        }
        await bothRequested;
        return free(roomId);
      });

      const results = await Promise.all([
        checkRoom(ROOM_201.id),
        checkRoom(ROOM_201.id),
      ]);

      for (const { rooms } of results) {
        expect(rooms).toEqual([
          { room: ROOM_201, available: true, reason: null, maintenance: [] },
        ]);
      }
    });

    it('al crear, la segunda vuelve a verificar (D3): con la reserva de la primera ya guardada, la 201 sale RESERVED', async () => {
      module1Answering();
      const [first, second] = await Promise.all([
        checkRoom(ROOM_201.id),
        checkRoom(ROOM_201.id),
      ]);
      expect([first.rooms[0].available, second.rooms[0].available]).toEqual([
        true,
        true,
      ]);

      // La primera confirma: su flujo vuelve a verificar y guarda la reserva de la 201 en esas fechas.
      expect((await checkRoom(ROOM_201.id)).rooms[0].available).toBe(true);
      await new TypeOrmReservationRepository(dataSource).insert(
        aDirectReservation({
          startDate: START,
          endDate: END,
          status: 'ACTIVE',
          rooms: [aDirectRoom({ roomId: ROOM_201.id })],
        }),
      );

      // La segunda confirma: su flujo vuelve a verificar antes de abrir la transacción de creación.
      const again = await checkRoom(ROOM_201.id);

      expect(again.rooms).toEqual([
        {
          room: ROOM_201,
          available: false,
          reason: 'RESERVED',
          maintenance: [],
        },
      ]);
    });
  });
});
