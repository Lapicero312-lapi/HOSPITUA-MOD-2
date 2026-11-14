import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { inspect } from 'node:util';
import { HttpService } from '@nestjs/axios';
import type { ConfigService } from '@nestjs/config';
import type { SchedulerRegistry } from '@nestjs/schedule';
import axios from 'axios';
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
import type {
  ChannexSettings,
  ChannexSetupState,
} from '../../src/application/ports/out/channex-setup-state.js';
import type { ChannexPort } from '../../src/application/ports/out/channex.port.js';
import type { EnsureChannexSetup } from '../../src/application/use-cases/configure-ota/ports/in/ensure-channex-setup.port.js';
import { VerifyChannexPropertyService } from '../../src/application/use-cases/configure-ota/verify-channex-property.service.js';
import { readChannexConfig } from '../../src/infrastructure/config/channex.config.js';
import { ChannexSetupJob } from '../../src/infrastructure/in/jobs/channex-setup.job.js';
import { ChannexHttpAdapter } from '../../src/infrastructure/out/channex/channex-http.adapter.js';
import { InMemoryChannexSetupState } from '../../src/infrastructure/out/channex/channex-setup.state.js';
import { captureLogs } from '../integration/support/capture-logs.js';

/**
 * NFR-002 de `configure-ota` (T014): la clave de acceso a Channex (`CHANNEX_API_KEY`) no sale en los logs, ni
 * en el mensaje de un error. Se recorren todas las llamadas del adaptador con cada respuesta posible de
 * Channex (también una que repite la clave en su cuerpo), la validación de la configuración y los servicios
 * que registran errores de Channex, y se comprueba todo lo que se escribió y todo lo que se lanzó.
 *
 * Es una prueba de contrato: Channex está simulado con msw y no necesita Docker. La que arranca la
 * aplicación completa con su log real es de integración.
 */

const BASE_URL = 'http://channex.test';
/** Reconocible y larga: si aparece completa o por partes en algún texto, la prueba falla. */
const API_KEY = 'ck-prueba-NFR002-0123456789-abcdefghij';
const PROPERTY_ID = '716305c4-561a-4561-a187-7f5b8aeb5920';
const ROOM_TYPE_ID = '994d1375-dbbd-4072-8724-b2ab32ce781b';
const TIMEOUT_MS = 100;

const SETTINGS = {
  CHANNEX_BASE_URL: BASE_URL,
  CHANNEX_API_KEY: API_KEY,
  CHANNEX_PROPERTY_ID: PROPERTY_ID,
};

const configWith = (values: Record<string, string | undefined>) =>
  ({ get: (name: string) => values[name] }) as unknown as ConfigService;

const newAdapter = () =>
  new ChannexHttpAdapter(
    new HttpService(axios.create({ timeout: TIMEOUT_MS })),
    configWith(SETTINGS),
  );

/** Un adaptador nuevo por llamada: una pausa por un 429 anterior no debe ocultar las demás llamadas. */
const OPERATIONS: [
  string,
  (adapter: ChannexHttpAdapter) => Promise<unknown>,
][] = [
  ['A0 listProperties', (a) => a.listProperties()],
  ['A1 listRoomTypes', (a) => a.listRoomTypes()],
  [
    'A2 createRoomType',
    (a) => a.createRoomType({ title: 'DOBLE', countOfRooms: 3, occupancy: 2 }),
  ],
  [
    'A3 updateRoomType',
    (a) =>
      a.updateRoomType(ROOM_TYPE_ID, {
        title: 'DOBLE',
        countOfRooms: 4,
        occupancy: 2,
      }),
  ],
  [
    'A4 pushAvailability',
    (a) =>
      a.pushAvailability([
        {
          roomTypeId: ROOM_TYPE_ID,
          dateFrom: '2026-11-10',
          dateTo: '2026-11-11',
          availability: 2,
        },
      ]),
  ],
  ['fetchBookingFeed', (a) => a.fetchBookingFeed(1)],
  ['ackBookingRevision', (a) => a.ackBookingRevision(ROOM_TYPE_ID)],
  ['reportNoShow', (a) => a.reportNoShow(ROOM_TYPE_ID)],
];

type Scenario = {
  name: string;
  respond: () => Response | Promise<Response>;
};

const channexError = (code: string, title: string, extra = {}) => ({
  errors: { code, title, ...extra },
});

const SCENARIOS: Scenario[] = [
  {
    name: '200 con JSON que no tiene la forma esperada',
    respond: () => HttpResponse.json({ data: 'otra forma' }),
  },
  {
    name: '200 con un texto que no es JSON',
    respond: () => new HttpResponse('<html>no es JSON</html>', { status: 200 }),
  },
  {
    name: '401',
    respond: () =>
      HttpResponse.json(channexError('unauthorized', 'Unauthorized'), {
        status: 401,
      }),
  },
  {
    name: '403',
    respond: () =>
      HttpResponse.json(channexError('forbidden', 'Forbidden'), {
        status: 403,
      }),
  },
  {
    name: '404',
    respond: () =>
      HttpResponse.json(channexError('resource_not_found', 'Not found'), {
        status: 404,
      }),
  },
  {
    name: '422',
    respond: () =>
      HttpResponse.json(channexError('validation_error', 'Invalid'), {
        status: 422,
      }),
  },
  {
    name: '422 que repite la clave en el cuerpo de la respuesta',
    respond: () =>
      HttpResponse.json(
        channexError('validation_error', `Invalid ${API_KEY}`, {
          details: { 'user-api-key': API_KEY },
        }),
        { status: 422 },
      ),
  },
  {
    name: '429',
    respond: () =>
      HttpResponse.json(channexError('too_many_requests', 'Rate limit'), {
        status: 429,
      }),
  },
  {
    name: '500',
    respond: () => new HttpResponse('Internal error', { status: 500 }),
  },
  {
    name: '503',
    respond: () => new HttpResponse(null, { status: 503 }),
  },
  {
    name: 'tiempo de espera agotado',
    respond: async () => {
      await delay(TIMEOUT_MS * 4);
      return HttpResponse.json({});
    },
  },
  {
    name: 'error de red',
    respond: () => HttpResponse.error(),
  },
];

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

describe('La clave de Channex no sale en los logs (NFR-002, T014 de configure-ota)', () => {
  beforeAll(() => {
    // En producción la clave está en el entorno: así un código que lea `process.env` y la escriba también
    // se detecta (los servicios y el adaptador reciben su configuración simulada, pero no es la única vía).
    process.env.CHANNEX_API_KEY = API_KEY;
    server.listen({ onUnhandledRequest: 'error' });
  });
  afterEach(() => {
    server.resetHandlers();
    vi.restoreAllMocks();
  });
  afterAll(() => {
    server.close();
    delete process.env.CHANNEX_API_KEY;
  });

  describe('el adaptador, en cada llamada y con cada respuesta de Channex', () => {
    it.each(SCENARIOS)(
      'con $name: ni el log ni los errores ni los resultados llevan la clave',
      async ({ respond }) => {
        const logs = captureLogs();
        const seenKeys: (string | null)[] = [];
        server.use(
          http.all(`${BASE_URL}/api/v1/*`, ({ request }) => {
            seenKeys.push(request.headers.get('user-api-key'));
            return respond();
          }),
        );
        const shown: string[] = [];

        for (const [, operation] of OPERATIONS) {
          const outcome: unknown = await operation(newAdapter()).then(
            (result) => result,
            (error: unknown) => error,
          );
          shown.push(everythingShownBy(outcome));
        }

        // La clave sí viajó en cada solicitud, así que tuvo oportunidad de filtrarse.
        expect(seenKeys).toHaveLength(OPERATIONS.length);
        expect(seenKeys.every((key) => key === API_KEY)).toBe(true);
        const output = [...logs, ...shown].join('\n');
        expect(output).not.toContain(API_KEY);
        expect(output).not.toContain(API_KEY.slice(0, 12));
      },
    );

    it('una feed con una revisión ilegible deja un aviso en el log y sin la clave', async () => {
      const logs = captureLogs();
      server.use(
        http.get(`${BASE_URL}/api/v1/booking_revisions/feed`, () =>
          HttpResponse.json({
            meta: { total: 1, page: 1, limit: 100 },
            data: [{ type: 'booking_revision', id: 'rev-1', attributes: {} }],
          }),
        ),
      );

      await newAdapter().fetchBookingFeed(1);

      expect(logs.length).toBeGreaterThan(0);
      expect(logs.join('\n')).not.toContain(API_KEY);
    });
  });

  describe('la configuración', () => {
    it.each([
      ['la URL no es válida', { CHANNEX_BASE_URL: 'no-es-una-url' }],
      ['la propiedad no es un UUID', { CHANNEX_PROPERTY_ID: 'no-es-uuid' }],
      ['el intervalo es menor que 30', { CHANNEX_SYNC_INTERVAL_SECONDS: '5' }],
      ['los días no son un entero', { CHANNEX_ARI_DAYS: 'noventa' }],
      [
        'todo es inválido a la vez',
        {
          CHANNEX_BASE_URL: 'x',
          CHANNEX_PROPERTY_ID: 'y',
          CHANNEX_SYNC_INTERVAL_SECONDS: 'z',
          CHANNEX_ARI_DAYS: '0',
        },
      ],
    ])(
      'si %s, nombra la variable que falló y no escribe la clave',
      (_, invalid) => {
        const logs = captureLogs();
        const values = { ...SETTINGS, ...invalid };

        const result = readChannexConfig(
          (name) => values[name as keyof typeof values],
        );
        const state = new InMemoryChannexSetupState(configWith(values));

        expect(result.valid).toBe(false);
        expect(state.settings()).toBeNull();
        expect(logs.length).toBeGreaterThan(0);
        const output = [
          ...logs,
          everythingShownBy(result),
          everythingShownBy(state.settings()),
        ].join('\n');
        expect(output).not.toContain(API_KEY);
      },
    );

    it('con la configuración válida, los ajustes que se guardan no llevan la clave', () => {
      const logs = captureLogs();

      const result = readChannexConfig(
        (name) => SETTINGS[name as keyof typeof SETTINGS],
      );
      const state = new InMemoryChannexSetupState(configWith(SETTINGS));

      expect(result.valid).toBe(true);
      const settings: ChannexSettings | null = state.settings();
      expect(settings).not.toBeNull();
      expect(Object.keys(settings ?? {})).not.toContain('apiKey');
      expect(Object.values(settings ?? {})).not.toContain(API_KEY);
      const output = [
        ...logs,
        everythingShownBy(result),
        everythingShownBy(settings),
      ].join('\n');
      expect(output).not.toContain(API_KEY);
    });
  });

  describe('los servicios que registran errores de Channex', () => {
    const state = (): ChannexSetupState => ({
      settings: () => ({
        baseUrl: BASE_URL,
        propertyId: PROPERTY_ID,
        syncIntervalSeconds: 30,
        ariDays: 90,
      }),
      isReady: () => false,
      isDisabled: () => false,
      markReady: vi.fn(),
      disable: vi.fn(),
    });

    it.each(SCENARIOS)(
      'VerifyChannexProperty con $name: el log no lleva la clave',
      async ({ respond }) => {
        const logs = captureLogs();
        server.use(http.all(`${BASE_URL}/api/v1/*`, () => respond()));
        const verification = new VerifyChannexPropertyService(
          newAdapter() as unknown as ChannexPort,
          state(),
        );

        const result = await verification.verify();

        expect(['READY', 'DISABLED', 'RETRY']).toContain(result);
        expect(logs.join('\n')).not.toContain(API_KEY);
      },
    );

    it('ChannexSetupJob registra con su pila un error de Channex sin la clave', async () => {
      const logs = captureLogs();
      server.use(
        http.all(`${BASE_URL}/api/v1/*`, () =>
          HttpResponse.json(channexError('unauthorized', API_KEY), {
            status: 401,
          }),
        ),
      );
      const adapter = newAdapter();
      const failing: EnsureChannexSetup = {
        ensure: () => adapter.listProperties().then(() => 'READY' as const),
      };
      const scheduler = {
        doesExist: () => false,
        addTimeout: (_name: string, timer: NodeJS.Timeout) =>
          clearTimeout(timer),
        deleteTimeout: vi.fn(),
      } as unknown as SchedulerRegistry;
      const job = new ChannexSetupJob(failing, state(), scheduler);

      await expect(job.attempt()).resolves.toBe('RETRY');

      expect(logs.length).toBeGreaterThan(0);
      expect(logs.join('\n')).not.toContain(API_KEY);
    });
  });

  describe('el código fuente', () => {
    const SRC = join(__dirname, '..', '..', 'src');

    function sourceFiles(directory: string): string[] {
      return readdirSync(directory).flatMap((name) => {
        const path = join(directory, name);
        return statSync(path).isDirectory()
          ? sourceFiles(path)
          : path.endsWith('.ts')
            ? [path]
            : [];
      });
    }

    it('solo la validación de la configuración y el adaptador de Channex nombran la clave', () => {
      const mentioning = sourceFiles(SRC)
        .filter((path) =>
          /CHANNEX_API_KEY|apiKey|user-api-key/.test(
            readFileSync(path, 'utf8'),
          ),
        )
        .map((path) => relative(SRC, path).split('\\').join('/'))
        .sort();

      // Si otro archivo empieza a leer la clave, hay que revisar que no la escriba en un log.
      expect(mentioning).toEqual([
        'infrastructure/config/channex.config.ts',
        'infrastructure/out/channex/channex-http.adapter.ts',
      ]);
    });

    it('ninguna llamada al log de esos dos archivos menciona la clave', () => {
      for (const file of [
        'infrastructure/config/channex.config.ts',
        'infrastructure/out/channex/channex-http.adapter.ts',
        'infrastructure/out/channex/channex-setup.state.ts',
      ]) {
        const code = readFileSync(join(SRC, file), 'utf8');
        const logCalls = [
          ...code.matchAll(
            /logger\.(?:log|warn|error|debug|verbose|fatal)\(([\s\S]*?)\);/g,
          ),
        ];
        for (const [call] of logCalls) {
          expect(call, `${file}: ${call}`).not.toMatch(/apiKey|API_KEY/i);
        }
      }
    });
  });
});
