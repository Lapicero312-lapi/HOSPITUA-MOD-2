import { inspect } from 'node:util';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
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
import {
  MODULE1_PORT,
  type Module1Port,
} from '../../src/application/ports/out/module1.port.js';
import { validateEnv } from '../../src/infrastructure/config/env.validation.js';
import { Module1ClientModule } from '../../src/infrastructure/out/module1/module1-client.module.js';
import { captureLogs } from '../integration/support/capture-logs.js';

/**
 * `X-Internal-Key` hacia el Módulo 1 (plan base, "Configuración del Módulo 1"; T017 de
 * `consult-room-inventory`): la clave se envía en todas las consultas a `/api/rooms…` solo si está
 * configurada, nunca viaja `Authorization` y no sale en los logs ni en los errores. Es una prueba de
 * contrato: el Módulo 1 está simulado con msw y no necesita Docker.
 */

const BASE_URL = 'http://module1.test';
const TIMEOUT_MS = 100;
const ROOM_ID = 'a0000000-0000-0000-0000-000000000103';
/** Reconocible y larga: si aparece completa o por partes en algún texto, la prueba falla. */
const INTERNAL_KEY = 'ik-prueba-T017-0123456789-abcdefghij';

const ROOM = {
  id: ROOM_ID,
  roomNumber: '103',
  categoryRoom: 'DOBLE',
  maxCapacity: 2,
};
const CALENDAR = { roomId: ROOM_ID, available: true, conflicts: [] };

/** El puerto del Módulo 1 armado por su módulo de Nest, con esta configuración. */
async function portWith(
  values: Record<string, string | number | undefined>,
): Promise<Module1Port> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        ignoreEnvVars: true,
        load: [
          () => ({
            MODULE1_BASE_URL: BASE_URL,
            MODULE1_TIMEOUT_MS: TIMEOUT_MS,
            MAINTENANCE_CONCURRENCY: 5,
            ...values,
          }),
        ],
      }),
      Module1ClientModule,
    ],
  }).compile();
  return moduleRef.get<Module1Port>(MODULE1_PORT);
}

/** Las cuatro consultas del Módulo 1 (A1, A2 y A3 de inventario y A1 de mantenimientos). */
const CALLS: [string, (port: Module1Port) => Promise<unknown>][] = [
  ['una habitación', (port) => port.getRoom(ROOM_ID)],
  ['las de una categoría', (port) => port.listRoomsByCategory('DOBLE')],
  ['todas las habitaciones', (port) => port.listRooms()],
  [
    'los mantenimientos',
    (port) => port.getMaintenances(ROOM_ID, '2026-10-10', '2026-10-12'),
  ],
];

/** Responde las cuatro rutas y guarda las cabeceras de cada consulta. */
function answerAll(seen: Headers[]) {
  return [
    http.get(`${BASE_URL}/api/rooms/:roomId/maintenances`, ({ request }) => {
      seen.push(request.headers);
      return HttpResponse.json(CALENDAR);
    }),
    http.get(`${BASE_URL}/api/rooms/:roomId`, ({ request }) => {
      seen.push(request.headers);
      return HttpResponse.json(ROOM);
    }),
    http.get(`${BASE_URL}/api/rooms`, ({ request }) => {
      seen.push(request.headers);
      return HttpResponse.json([ROOM]);
    }),
  ];
}

/** Todo lo que puede mostrar un valor o un error: texto, JSON, pila y su contenido completo. */
function everythingShownBy(value: unknown): string {
  const parts = [inspect(value, { depth: null }), String(value)];
  try {
    parts.push(JSON.stringify(value) ?? '');
  } catch {
    // Un valor circular no se puede pasar a JSON: `inspect` ya lo mostró.
  }
  if (value instanceof Error) {
    parts.push(value.stack ?? '', inspect(value.cause, { depth: null }));
  }
  return parts.join('\n');
}

const server = setupServer();

describe('X-Internal-Key hacia el Módulo 1 (T017 de consult-room-inventory)', () => {
  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => {
    server.resetHandlers();
    vi.restoreAllMocks();
  });
  afterAll(() => server.close());

  it.each(CALLS)(
    'con la clave configurada, la consulta de %s la envía en X-Internal-Key y no envía Authorization',
    async (_name, call) => {
      const seen: Headers[] = [];
      server.use(...answerAll(seen));

      await call(await portWith({ MODULE1_INTERNAL_KEY: INTERNAL_KEY }));

      expect(seen).toHaveLength(1);
      expect(seen[0].get('x-internal-key')).toBe(INTERNAL_KEY);
      expect(seen[0].get('authorization')).toBeNull();
    },
  );

  it.each([
    ['sin la variable', undefined],
    ['con la variable vacía', ''],
  ])('%s no envía la cabecera en ninguna consulta', async (_name, value) => {
    const seen: Headers[] = [];
    server.use(...answerAll(seen));
    const port = await portWith({ MODULE1_INTERNAL_KEY: value });

    for (const [, call] of CALLS) {
      await call(port);
    }

    expect(seen).toHaveLength(CALLS.length);
    for (const headers of seen) {
      expect(headers.get('x-internal-key')).toBeNull();
      expect(headers.get('authorization')).toBeNull();
    }
  });

  describe('la clave no sale en los logs ni en los errores', () => {
    const SCENARIOS: [string, () => Response | Promise<Response>][] = [
      ['200', () => HttpResponse.json(ROOM)],
      ['403', () => new HttpResponse('Forbidden', { status: 403 })],
      [
        '400 que repite la clave en el cuerpo',
        () =>
          HttpResponse.json(
            { errorCode: 'INVALID', message: `Clave ${INTERNAL_KEY}` },
            { status: 400 },
          ),
      ],
      ['404', () => new HttpResponse(null, { status: 404 })],
      ['500', () => new HttpResponse('Internal error', { status: 500 })],
      [
        'tiempo de espera agotado',
        async () => {
          await delay(TIMEOUT_MS * 4);
          return HttpResponse.json(ROOM);
        },
      ],
      ['error de red', () => HttpResponse.error()],
    ];

    it.each(SCENARIOS)(
      'con %s: ni el log ni el resultado llevan la clave',
      async (_name, respond) => {
        const logs = captureLogs();
        const seen: (string | null)[] = [];
        server.use(
          http.get(`${BASE_URL}/api/rooms/:roomId`, ({ request }) => {
            seen.push(request.headers.get('x-internal-key'));
            return respond();
          }),
        );

        const outcome: unknown = await (
          await portWith({ MODULE1_INTERNAL_KEY: INTERNAL_KEY })
        )
          .getRoom(ROOM_ID)
          .then(
            (result) => result,
            (error: unknown) => error,
          );

        // La clave sí viajó, así que tuvo oportunidad de filtrarse.
        expect(seen).toEqual([INTERNAL_KEY]);
        const output = [...logs, everythingShownBy(outcome)].join('\n');
        expect(output).not.toContain(INTERNAL_KEY.replace('ik-prueba-', ''));
      },
    );
  });

  describe('la validación del entorno', () => {
    const base = { NODE_ENV: 'test', LOG_LEVEL: 'silent' };

    it('acepta la variable ausente, vacía o con una clave válida', () => {
      expect(() => validateEnv({ ...base })).not.toThrow();
      expect(() =>
        validateEnv({ ...base, MODULE1_INTERNAL_KEY: '' }),
      ).not.toThrow();
      expect(
        validateEnv({ ...base, MODULE1_INTERNAL_KEY: INTERNAL_KEY })
          .MODULE1_INTERNAL_KEY,
      ).toBe(INTERNAL_KEY);
    });

    it('rechaza una clave con espacios o saltos de línea sin repetirla en el mensaje', () => {
      for (const invalid of ['con espacio', `${INTERNAL_KEY}\nX-Otra: 1`]) {
        let message = '';
        try {
          validateEnv({ ...base, MODULE1_INTERNAL_KEY: invalid });
        } catch (error) {
          message = (error as Error).message;
        }
        expect(message).toContain('MODULE1_INTERNAL_KEY');
        expect(message).not.toContain(INTERNAL_KEY);
      }
    });
  });
});
