import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { delay, http, HttpResponse, type JsonBodyType } from 'msw';
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
import { ConsultMaintenanceCalendarService } from '../../../src/application/use-cases/consult-maintenance-calendar/consult-maintenance-calendar.service.js';
import {
  CONSULT_MAINTENANCE_CALENDAR,
  type ConsultMaintenanceCalendar,
} from '../../../src/application/use-cases/consult-maintenance-calendar/ports/in/consult-maintenance-calendar.port.js';
import {
  INVALID_ROOM_ID,
  INVALID_STAY_DATES,
  MAINTENANCE_CHECK_UNAVAILABLE,
} from '../../../src/domain/shared/error-codes.js';
import { AppConfigModule } from '../../../src/infrastructure/config/app-config.module.js';
import type { EnvironmentVariables } from '../../../src/infrastructure/config/env.validation.js';
import { Module1ClientModule } from '../../../src/infrastructure/out/module1/module1-client.module.js';

/**
 * Pruebas de integración de `consult-maintenance-calendar` (T011 y T014): el servicio, el adaptador HTTP y
 * la configuración reales, armados con Nest, contra el Módulo 1 simulado (msw). Las pruebas unitarias del
 * servicio usan un `Module1Port` simulado; estas comprueban que las piezas funcionan juntas.
 */

/**
 * Datos de las pruebas del plan ("Pruebas por escenario", T011 y T014), que dice de dónde sale cada uno.
 * El `roomId` es un UUID cualquiera.
 */
const ROOM_ID = randomUUID();
const START_DATE = '2026-10-11';
const END_DATE = '2026-10-14';

const server = setupServer();

/** Cuántas consultas recibió el Módulo 1 simulado en la prueba. */
let requests = 0;

/** Las fechas que pidió el adaptador en la última consulta. */
let requestedDates: Record<string, string> = {};

describe('ConsultMaintenanceCalendar contra el Módulo 1 simulado', () => {
  let moduleRef: TestingModule;
  let calendar: ConsultMaintenanceCalendar;
  let maintenancesUrl: string;
  let timeoutMs: number;

  // Arrancar Nest por primera vez puede tardar más que el tiempo de una prueba: se hace una sola vez.
  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, Module1ClientModule],
      providers: [
        {
          provide: CONSULT_MAINTENANCE_CALENDAR,
          useClass: ConsultMaintenanceCalendarService,
        },
      ],
    }).compile();
    calendar = moduleRef.get(CONSULT_MAINTENANCE_CALENDAR);

    const config =
      moduleRef.get<ConfigService<EnvironmentVariables, true>>(ConfigService);
    maintenancesUrl = `${config.get('MODULE1_BASE_URL', { infer: true })}/api/rooms/${ROOM_ID}/maintenances`;
    timeoutMs = config.get('MODULE1_TIMEOUT_MS', { infer: true });

    server.events.on('request:start', () => {
      requests += 1;
    });
    server.listen({ onUnhandledRequest: 'error' });
  });

  afterEach(() => {
    server.resetHandlers();
    requests = 0;
    requestedDates = {};
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    server.close();
    await moduleRef.close();
  });

  /** El Módulo 1 simulado responde `body` con el estado `status` a la consulta de la habitación. */
  function module1Responds(body: JsonBodyType, status = 200): void {
    server.use(
      http.get(maintenancesUrl, ({ request }) => {
        requestedDates = Object.fromEntries(new URL(request.url).searchParams);
        return HttpResponse.json(body, { status });
      }),
    );
  }

  /** La respuesta del Módulo 1 sin mantenimientos que se crucen con la estadía. */
  const available = { roomId: ROOM_ID, available: true, conflicts: [] };

  describe('escenarios', () => {
    it('1, sin mantenimientos: la habitación está disponible y se pidieron las fechas de la estadía', async () => {
      module1Responds(available);

      expect(await calendar.check(ROOM_ID, START_DATE, END_DATE)).toEqual({
        roomId: ROOM_ID,
        available: true,
        conflicts: [],
      });
      expect(requestedDates).toEqual({
        startDate: START_DATE,
        endDate: END_DATE,
      });
    });

    it('2, cruce parcial: la habitación está inhabilitada y se devuelve el periodo del cruce', async () => {
      module1Responds({
        roomId: ROOM_ID,
        available: false,
        conflicts: [
          { maintenanceStart: '2026-10-10', maintenanceEnd: '2026-10-12' },
        ],
      });

      expect(await calendar.check(ROOM_ID, START_DATE, END_DATE)).toEqual({
        roomId: ROOM_ID,
        available: false,
        conflicts: [
          {
            maintenanceStart: '2026-10-10',
            maintenanceEnd: '2026-10-12',
            overlapStart: '2026-10-11',
            overlapEnd: '2026-10-12',
          },
        ],
      });
    });

    it('2, cruce total: el cruce termina el día antes de la salida', async () => {
      module1Responds({
        roomId: ROOM_ID,
        available: false,
        conflicts: [
          { maintenanceStart: '2026-10-10', maintenanceEnd: '2026-10-14' },
        ],
      });

      expect(await calendar.check(ROOM_ID, START_DATE, END_DATE)).toEqual({
        roomId: ROOM_ID,
        available: false,
        conflicts: [
          {
            maintenanceStart: '2026-10-10',
            maintenanceEnd: '2026-10-14',
            overlapStart: '2026-10-11',
            overlapEnd: '2026-10-13',
          },
        ],
      });
    });

    it('3, contiguo: un mantenimiento que termina el día antes de la llegada no cruza y la habitación puede reservarse', async () => {
      // El Módulo 1 decide si hay cruce: el mantenimiento que termina el 2026-10-10 no lo es.
      module1Responds(available);

      expect(await calendar.check(ROOM_ID, START_DATE, END_DATE)).toEqual({
        roomId: ROOM_ID,
        available: true,
        conflicts: [],
      });
    });
  });

  describe('casos borde de error', () => {
    it('el Módulo 1 no responde dentro del tiempo máximo: MAINTENANCE_CHECK_UNAVAILABLE, sin asumir que está libre', async () => {
      // El detalle va al log (T009); aquí solo se silencia.
      vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      server.use(
        http.get(maintenancesUrl, async () => {
          await delay(timeoutMs * 2);
          return HttpResponse.json(available);
        }),
      );

      await expect(
        calendar.check(ROOM_ID, START_DATE, END_DATE),
      ).rejects.toMatchObject({
        errorCode: MAINTENANCE_CHECK_UNAVAILABLE.code,
        message: MAINTENANCE_CHECK_UNAVAILABLE.message,
      });
    });

    it.each([
      ['la salida anterior a la llegada', '2026-10-14', '2026-10-11'],
      ['una fecha inexistente', '2026-02-28', '2026-02-30'],
      ['una fecha mal formada', '2026-10-11', '14/10/2026'],
    ])(
      'fechas inválidas (%s): INVALID_STAY_DATES, sin llamar al Módulo 1',
      async (_, startDate, endDate) => {
        module1Responds(available);

        await expect(
          calendar.check(ROOM_ID, startDate, endDate),
        ).rejects.toMatchObject({
          errorCode: INVALID_STAY_DATES.code,
          message: INVALID_STAY_DATES.message,
        });
        expect(requests).toBe(0);
      },
    );

    it('un roomId que es un número de habitación (201): INVALID_ROOM_ID, sin llamar al Módulo 1', async () => {
      module1Responds(available);

      await expect(
        calendar.check('201', START_DATE, END_DATE),
      ).rejects.toMatchObject({
        errorCode: INVALID_ROOM_ID.code,
        message: INVALID_ROOM_ID.message,
      });
      expect(requests).toBe(0);
    });

    it('un roomId que el Módulo 1 no conoce (404): INVALID_ROOM_ID', async () => {
      module1Responds({}, 404);

      await expect(
        calendar.check(ROOM_ID, START_DATE, END_DATE),
      ).rejects.toMatchObject({
        errorCode: INVALID_ROOM_ID.code,
        message: INVALID_ROOM_ID.message,
      });
      expect(requests).toBe(1);
    });
  });

  /** El mantenimiento del 2026-10-10 al 2026-10-12, que cruza la estadía. */
  const crossing = {
    maintenanceStart: '2026-10-10',
    maintenanceEnd: '2026-10-12',
  };

  describe('tiempo de respuesta (NFR-001)', () => {
    it.each<[string, JsonBodyType]>([
      ['sin mantenimientos', available],
      [
        'con un cruce',
        { roomId: ROOM_ID, available: false, conflicts: [crossing] },
      ],
    ])(
      '%s: con el Módulo 1 a 200 ms, check responde en menos de 1 s',
      async (_, body) => {
        server.use(
          http.get(maintenancesUrl, async () => {
            await delay(200);
            return HttpResponse.json(body);
          }),
        );

        const start = performance.now();
        await calendar.check(ROOM_ID, START_DATE, END_DATE);

        expect(performance.now() - start).toBeLessThan(1000);
      },
    );
  });

  describe('logs sin datos personales', () => {
    /** El nombre de una persona (el del ejemplo del plan de `check-view-reservation`). */
    const PERSON = 'Ana Pérez';

    /** El mantenimiento que cruza, con un motivo que el Módulo 1 no debería enviar (no llega al Módulo 2). */
    const withReason = {
      ...crossing,
      reason: `Reparación pedida por ${PERSON}`,
    };

    /** Todo lo que se escribe en el log durante la prueba, en cualquier nivel. */
    function captureLogs(): string[] {
      const lines: string[] = [];
      for (const level of [
        'log',
        'error',
        'warn',
        'debug',
        'verbose',
        'fatal',
      ] as const) {
        vi.spyOn(Logger.prototype, level).mockImplementation(
          (...args: unknown[]) => {
            lines.push(args.map(String).join(' '));
          },
        );
      }
      return lines;
    }

    it.each<[string, JsonBodyType, number]>([
      [
        'un 503',
        { roomId: ROOM_ID, available: false, conflicts: [withReason] },
        503,
      ],
      [
        'una respuesta incoherente (available true con un cruce)',
        { roomId: ROOM_ID, available: true, conflicts: [withReason] },
        200,
      ],
      [
        'una respuesta mal formada (una fecha inexistente)',
        {
          roomId: ROOM_ID,
          available: false,
          conflicts: [{ ...withReason, maintenanceStart: '2026-02-30' }],
        },
        200,
      ],
    ])(
      '%s: se escribe el log, sin la respuesta del Módulo 1',
      async (_, body, status) => {
        const logs = captureLogs();
        module1Responds(body, status);

        await expect(
          calendar.check(ROOM_ID, START_DATE, END_DATE),
        ).rejects.toMatchObject({
          errorCode: MAINTENANCE_CHECK_UNAVAILABLE.code,
        });
        expect(logs).not.toHaveLength(0);
        expect(logs.join('\n')).not.toContain(PERSON);
      },
    );

    it('una respuesta válida con un cruce no deja la respuesta del Módulo 1 en el log', async () => {
      const logs = captureLogs();
      module1Responds({
        roomId: ROOM_ID,
        available: false,
        conflicts: [withReason],
      });

      await calendar.check(ROOM_ID, START_DATE, END_DATE);

      expect(logs.join('\n')).not.toContain(PERSON);
    });
  });
});
