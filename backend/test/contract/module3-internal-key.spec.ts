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
  MODULE3_PORT,
  type Module3Port,
} from '../../src/application/ports/out/module3.port.js';
import { validateEnv } from '../../src/infrastructure/config/env.validation.js';
import { Module3ClientModule } from '../../src/infrastructure/out/module3/module3-client.module.js';
import { captureLogs } from '../integration/support/capture-logs.js';

/**
 * `X-Internal-Key` hacia el Módulo 3 (plan de `calculate-dynamic-rate`, A1 y T024): la clave se envía solo si
 * está configurada, nunca viaja `Authorization` (el Módulo 3 responde 403 si la recibe) y no sale en los
 * logs ni en los errores. Es una prueba de contrato: el Módulo 3 está simulado con msw y no necesita Docker.
 */

const BASE_URL = 'http://module3.test';
const URL_QUOTES = `${BASE_URL}/pricing/quotes`;
const TIMEOUT_MS = 100;
const ROOM_ID = '3f6c1e2a-8b4d-4c7e-9a1f-2b3c4d5e6f70';
/** Reconocible y larga: si aparece completa o por partes en algún texto, la prueba falla. */
const INTERNAL_KEY = 'ik-prueba-T024-0123456789-abcdefghij';

const QUOTE_BODY = JSON.stringify({
  quoteId: 'a1f2c3d4-e5b6-4789-8a9b-0c1d2e3f4a5b',
  currency: 'COP',
  nightlyRates: [{ date: '2026-10-10', rate: '250000.00' }],
  lodgingAmount: '250000.00',
});

/** El puerto del Módulo 3 armado por su módulo de Nest, con esta configuración. */
async function portWith(
  values: Record<string, string | number | undefined>,
): Promise<Module3Port> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        ignoreEnvVars: true,
        load: [
          () => ({
            MODULE3_BASE_URL: BASE_URL,
            MODULE3_TIMEOUT_MS: TIMEOUT_MS,
            QUOTE_CONCURRENCY: 5,
            ...values,
          }),
        ],
      }),
      Module3ClientModule,
    ],
  }).compile();
  return moduleRef.get<Module3Port>(MODULE3_PORT);
}

const quote = (port: Module3Port) =>
  port.createQuote('DOBLE', ROOM_ID, '2026-10-10', '2026-10-12');

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

describe('X-Internal-Key hacia el Módulo 3 (T024 de calculate-dynamic-rate)', () => {
  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => {
    server.resetHandlers();
    vi.restoreAllMocks();
  });
  afterAll(() => server.close());

  it('con la clave configurada la envía en X-Internal-Key y no envía Authorization', async () => {
    let headers: Headers | null = null;
    server.use(
      http.post(URL_QUOTES, ({ request }) => {
        headers = request.headers;
        return new HttpResponse(QUOTE_BODY, {
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );

    await quote(await portWith({ MODULE3_INTERNAL_KEY: INTERNAL_KEY }));

    expect(headers).not.toBeNull();
    expect(headers!.get('x-internal-key')).toBe(INTERNAL_KEY);
    expect(headers!.get('authorization')).toBeNull();
  });

  it.each([
    ['sin la variable', undefined],
    ['con la variable vacía', ''],
  ])('%s no envía la cabecera', async (_name, value) => {
    let headers: Headers | null = null;
    server.use(
      http.post(URL_QUOTES, ({ request }) => {
        headers = request.headers;
        return new HttpResponse(QUOTE_BODY, {
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );

    await quote(await portWith({ MODULE3_INTERNAL_KEY: value }));

    expect(headers!.get('x-internal-key')).toBeNull();
    expect(headers!.get('authorization')).toBeNull();
  });

  describe('la clave no sale en los logs ni en los errores', () => {
    const SCENARIOS: [string, () => Response | Promise<Response>][] = [
      ['200', () => new HttpResponse(QUOTE_BODY, { status: 200 })],
      ['403', () => new HttpResponse('Forbidden', { status: 403 })],
      [
        '400 que repite la clave en el cuerpo',
        () =>
          HttpResponse.json(
            { errorCode: 'INVALID', message: `Clave ${INTERNAL_KEY}` },
            { status: 400 },
          ),
      ],
      ['500', () => new HttpResponse('Internal error', { status: 500 })],
      [
        'tiempo de espera agotado',
        async () => {
          await delay(TIMEOUT_MS * 4);
          return HttpResponse.json({});
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
          http.post(URL_QUOTES, ({ request }) => {
            seen.push(request.headers.get('x-internal-key'));
            return respond();
          }),
        );

        const outcome: unknown = await quote(
          await portWith({ MODULE3_INTERNAL_KEY: INTERNAL_KEY }),
        ).then(
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
        validateEnv({ ...base, MODULE3_INTERNAL_KEY: '' }),
      ).not.toThrow();
      expect(
        validateEnv({ ...base, MODULE3_INTERNAL_KEY: INTERNAL_KEY })
          .MODULE3_INTERNAL_KEY,
      ).toBe(INTERNAL_KEY);
    });

    it('rechaza una clave con espacios o saltos de línea sin repetirla en el mensaje', () => {
      for (const invalid of ['con espacio', `${INTERNAL_KEY}\nX-Otra: 1`]) {
        let message = '';
        try {
          validateEnv({ ...base, MODULE3_INTERNAL_KEY: invalid });
        } catch (error) {
          message = (error as Error).message;
        }
        expect(message).toContain('MODULE3_INTERNAL_KEY');
        expect(message).not.toContain(INTERNAL_KEY);
      }
    });
  });
});
