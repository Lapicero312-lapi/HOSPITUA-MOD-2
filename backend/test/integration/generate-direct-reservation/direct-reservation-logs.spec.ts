import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { Logger, PARAMS_PROVIDER_TOKEN } from 'nestjs-pino';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { DataSource } from 'typeorm';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { CLOCK, type Clock } from '../../../src/application/ports/out/clock.js';
import {
  RESERVATION_REPOSITORY,
  type ReservationRepository,
} from '../../../src/application/ports/out/reservation.repository.js';
import { configureApp } from '../../../src/configure-app.js';
import type { EnvironmentVariables } from '../../../src/infrastructure/config/env.validation.js';
import { pinoHttpOptions } from '../../../src/infrastructure/shared/logging.options.js';
import {
  aDirectReservation,
  aDirectRoom,
  aGuest,
} from '../../support/builders.js';
import { ROOM_201, ROOM_202 } from '../../support/rooms.js';
import { integrationEnv, truncateAllTables } from '../support/database.js';

/**
 * T016 de `generate-direct-reservation`: ningún log escribe datos personales del titular (plan base, "Logs
 * y correlación": "de la solicitud solo se registran el método, el patrón de la ruta y `X-Client`; nunca
 * cabeceras, cuerpo ni consulta", y los errores no controlados van "con su detalle, sin datos de la
 * solicitud"). El titular llega en dos rutas: en el cuerpo de la creación (B) y en la consulta de la
 * precarga (E). La vista previa (A) no lo recibe.
 *
 * La aplicación completa, con PostgreSQL y RabbitMQ reales y sus logs como en producción, pero en el nivel
 * más bajo y dirigidos a la prueba; también se recoge lo que se escriba con `console`. Los Módulos 1 y 3 se
 * simulan en HTTP (msw), así que sus clientes y sus errores también son los reales. Se recorre cada camino,
 * los que terminan bien y los que fallan, y se revisa todo lo que se escribió.
 */

/** Un día operativo propio de esta prueba, y una estadía de dos noches después de él. */
const TODAY = '2032-03-01';
const START = '2032-03-10';
const END = '2032-03-12';
const clock: Clock = {
  today: () => TODAY,
  now: () => new Date('2032-03-01T15:00:00.000Z'),
};

/** El titular del ejemplo de B del plan (el mismo de `aGuest`). */
const HOLDER = {
  firstName: 'Valentina',
  lastName: 'Ospina',
  documentType: 'CC',
  documentNumber: '1144093552',
  nationality: 'Colombia',
  contactPhone: '+57 300 000 0000',
  contactEmail: 'valentina@correo.com',
} as const;

/** Lo que no puede salir en un log: todos los datos del titular salvo su tipo de documento. */
const PERSONAL_DATA = [
  HOLDER.firstName,
  HOLDER.lastName,
  HOLDER.documentNumber,
  HOLDER.nationality,
  HOLDER.contactPhone,
  HOLDER.contactEmail,
];

/** Lo que cotiza el Módulo 3 simulado por cada habitación: dos noches de 375000.00. */
const LODGING_AMOUNT = '750000.00';

/** La solicitud del ejemplo de B: dos habitaciones `DOBLE` de 2 personas, con el titular. */
const aBody = (changes: object = {}) => ({
  startDate: START,
  endDate: END,
  categoryRoom: 'DOBLE',
  rooms: [{ guestCount: 2 }, { guestCount: 2 }],
  guest: HOLDER,
  notes: 'Llegada después de las 8 p. m.',
  expectedRates: [
    { position: 1, lodgingAmount: LODGING_AMOUNT, currency: 'COP' },
    { position: 2, lodgingAmount: LODGING_AMOUNT, currency: 'COP' },
  ],
  ...changes,
});

/** Una línea del log de pino (JSON); las de cada solicitud traen `req`, `route` y `res`. */
type LogLine = {
  level: number;
  msg: string;
  req?: { method: string; client: string | null };
  route?: string | null;
  res?: { statusCode: number; errorCode?: string };
};

const CREATE_ROUTE = '/api/reservations/direct';
const LOOKUP_ROUTE = '/api/guests/lookup';

const server = setupServer();

describe('Reserva directa: los logs no escriben datos personales del titular (T016)', () => {
  let app: INestApplication<App>;
  let module1Url: string;
  let module3Url: string;
  /** Lo que escribe pino, tal como sale (una o más líneas JSON por escritura). */
  let written: string[] = [];
  /** Lo que se escribe con `console`. */
  let consoleLines: string[] = [];

  const pinoLines = (): string[] =>
    written.flatMap((chunk) => chunk.split('\n')).filter((line) => line !== '');
  /** Todo lo que se escribió en el log durante la prueba. */
  const allLogs = (): string => [...pinoLines(), ...consoleLines].join('\n');
  const requestLogs = (): LogLine[] =>
    pinoLines()
      .map((line) => JSON.parse(line) as LogLine)
      .filter((line) => line.req !== undefined);

  /**
   * Espera el log de la solicitud (se escribe al terminar la respuesta) y revisa que trae el patrón de la
   * ruta, el estado y el código de error, y que en todo lo escrito no hay ningún dato del titular ni
   * ninguno de los valores rechazados.
   */
  async function expectCleanLogs(
    method: 'GET' | 'POST',
    route: string | null,
    statusCode: number,
    errorCode?: string,
    rejected: readonly string[] = [],
  ): Promise<void> {
    await vi.waitFor(() => expect(requestLogs()).toHaveLength(1), {
      timeout: 5_000,
      interval: 10,
    });
    expect(requestLogs()[0]).toMatchObject({
      req: { method },
      route,
      res: errorCode === undefined ? { statusCode } : { statusCode, errorCode },
    });
    const logs = allLogs();
    for (const value of [...PERSONAL_DATA, ...rejected]) {
      expect(logs).not.toContain(value);
    }
  }

  const create = (body: object) =>
    request(app.getHttpServer())
      .post(CREATE_ROUTE)
      // Una clave nueva por solicitud: la creación la exige (punto 15, T019).
      .set('Idempotency-Key', randomUUID())
      .send(body);

  const lookup = (documentType: string, documentNumber: string) =>
    request(app.getHttpServer())
      .get(LOOKUP_ROUTE)
      .query({ documentType, documentNumber });

  /** Una reserva del titular que ocupa esa habitación en la estadía de la prueba. */
  const occupy = (roomId: string, roomNumber: string) =>
    app.get<ReservationRepository>(RESERVATION_REPOSITORY).insert(
      aDirectReservation({
        startDate: START,
        endDate: END,
        guest: aGuest(),
        rooms: [aDirectRoom({ roomId, roomNumber })],
      }),
    );

  /** El Módulo 1 con la 201 y la 202 de `DOBLE`, sin mantenimientos. */
  function module1Answering(): void {
    server.use(
      http.get(`${module1Url}/api/rooms`, () =>
        HttpResponse.json([ROOM_201, ROOM_202]),
      ),
      http.get(`${module1Url}/api/rooms/:roomId/maintenances`, ({ params }) =>
        HttpResponse.json({
          roomId: params.roomId,
          available: true,
          conflicts: [],
        }),
      ),
    );
  }

  /** El Módulo 3 que cotiza cada habitación en `LODGING_AMOUNT`, con un `quoteId` distinto cada vez. */
  function module3Answering(): void {
    let quoteNumber = 0;
    server.use(
      http.post(`${module3Url}/pricing/quotes`, () => {
        quoteNumber += 1;
        return HttpResponse.json({
          quoteId: `00000000-0000-4000-8000-${String(quoteNumber).padStart(12, '0')}`,
          currency: 'COP',
          nightlyRates: [
            { date: START, rate: '375000.00' },
            { date: '2032-03-11', rate: '375000.00' },
          ],
          lodgingAmount: LODGING_AMOUNT,
        });
      }),
    );
  }

  beforeAll(async () => {
    // AppConfigModule lee el entorno al importarse: AppModule se importa después de asignarlo.
    Object.assign(process.env, { NODE_ENV: 'test', ...integrationEnv() });
    const { AppModule } = await import('../../../src/app.module.js');
    // La aplicación completa también llama a Channex al arrancar, y esta prueba no lo simula.
    server.listen({ onUnhandledRequest: 'bypass' });
    const destination = new Writable({
      write(chunk: Buffer, _encoding, done) {
        written.push(chunk.toString());
        done();
      },
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PARAMS_PROVIDER_TOKEN)
      .useValue({ pinoHttp: [pinoHttpOptions('trace'), destination] })
      .overrideProvider(CLOCK)
      .useValue(clock)
      .compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    app.useLogger(app.get(Logger));
    configureApp(app);
    await app.init();
    const config =
      app.get<ConfigService<EnvironmentVariables, true>>(ConfigService);
    module1Url = config.get('MODULE1_BASE_URL', { infer: true });
    module3Url = config.get('MODULE3_BASE_URL', { infer: true });
  });

  beforeEach(async () => {
    await truncateAllTables(app.get(DataSource));
    module1Answering();
    module3Answering();
    written = [];
    consoleLines = [];
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        consoleLines.push(args.map(String).join(' '));
      });
    }
  });

  afterEach(() => {
    server.resetHandlers();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    server.close();
    await app?.close();
  });

  describe('la creación (B), con el titular en el cuerpo', () => {
    it('la reserva creada: la respuesta trae al titular, el log no', async () => {
      const res = await create(aBody()).expect(201);

      // La respuesta sí lo trae: así se sabe que se revisa una creación con sus datos.
      expect(res.body.guest).toEqual(HOLDER);
      await expectCleanLogs('POST', CREATE_ROUTE, 201);
    });

    it.each<[string, object, string, string[]]>([
      ['falta la nacionalidad', { nationality: '' }, 'GUEST_DATA_REQUIRED', []],
      [
        'un tipo de documento que no existe',
        { documentType: 'DNI' },
        'INVALID_DOCUMENT_TYPE',
        ['DNI'],
      ],
      [
        'un documento con puntos',
        { documentNumber: '1144.093.552' },
        'INVALID_CHARACTERS',
        ['1144.093.552'],
      ],
      [
        'un nombre más largo que su columna',
        { firstName: HOLDER.firstName.repeat(12) },
        'INVALID_CHARACTERS',
        [],
      ],
      [
        'un correo sin dominio',
        { contactEmail: 'valentina@correo' },
        'INVALID_EMAIL',
        ['valentina@correo'],
      ],
    ])(
      'un titular rechazado (%s): el log no dice qué dato ni de quién',
      async (_case, guestChanges, errorCode, rejected) => {
        await create(aBody({ guest: { ...HOLDER, ...guestChanges } })).expect(
          400,
        );

        await expectCleanLogs('POST', CREATE_ROUTE, 400, errorCode, rejected);
      },
    );

    it('sin habitaciones libres (NO_AVAILABILITY), ocupadas por otras reservas del mismo titular', async () => {
      await occupy(ROOM_201.id, '201');
      await occupy(ROOM_202.id, '202');

      await create(aBody()).expect(400);

      await expectCleanLogs('POST', CREATE_ROUTE, 400, 'NO_AVAILABILITY');
    });

    it('la tarifa cambió (RATE_CHANGED)', async () => {
      await create(
        aBody({
          expectedRates: [
            { position: 1, lodgingAmount: '700000.00', currency: 'COP' },
            { position: 2, lodgingAmount: LODGING_AMOUNT, currency: 'COP' },
          ],
        }),
      ).expect(400);

      await expectCleanLogs('POST', CREATE_ROUTE, 400, 'RATE_CHANGED');
    });

    it('el Módulo 1 no responde (INVENTORY_UNAVAILABLE)', async () => {
      server.use(
        http.get(
          `${module1Url}/api/rooms`,
          () => new HttpResponse(null, { status: 503 }),
        ),
      );

      await create(aBody()).expect(400);

      await expectCleanLogs('POST', CREATE_ROUTE, 400, 'INVENTORY_UNAVAILABLE');
    });

    it('el Módulo 3 no responde (PRICING_UNAVAILABLE): el aviso queda en el log, sin datos del titular', async () => {
      server.use(
        http.post(
          `${module3Url}/pricing/quotes`,
          () => new HttpResponse(null, { status: 503 }),
        ),
      );

      await create(aBody()).expect(400);

      await expectCleanLogs('POST', CREATE_ROUTE, 400, 'PRICING_UNAVAILABLE');
      // El aviso sí quedó escrito: la prueba no pasa por no haber nada que revisar.
      expect(allLogs()).toContain('respondió 503');
    });

    it('la base rechaza al titular al guardarlo (REQUEST_NOT_PROCESSED): el error queda en el log, sin los datos que se guardaban', async () => {
      // Una falla real de PostgreSQL: el error de TypeORM lleva los datos del titular entre los parámetros
      // de la consulta y en el detalle de la base.
      const dataSource = app.get(DataSource);
      await dataSource.query(
        `ALTER TABLE guest ADD CONSTRAINT ck_prueba_t016 CHECK (document_number <> '${HOLDER.documentNumber}') NOT VALID`,
      );
      try {
        await create(aBody()).expect(400);
      } finally {
        await dataSource.query(
          'ALTER TABLE guest DROP CONSTRAINT ck_prueba_t016',
        );
      }

      await expectCleanLogs('POST', CREATE_ROUTE, 400, 'REQUEST_NOT_PROCESSED');
      // La falla sí quedó escrita: la prueba no pasa por no haber nada que revisar.
      expect(allLogs()).toContain('ck_prueba_t016');
    });

    it('un JSON mal formado con los datos del titular (REQUEST_NOT_PROCESSED): el error cita el texto, el log no', async () => {
      // El nombre sin comillas: el error de JSON cita el texto ("Unexpected token 'V', ..."rstName":
      // Valentina}"... is not valid JSON"), así que si ese mensaje fuera al log, el nombre saldría.
      const res = await request(app.getHttpServer())
        .post(CREATE_ROUTE)
        .set('Content-Type', 'application/json')
        .send(
          `{"guest": {"documentNumber": "${HOLDER.documentNumber}", "firstName": ${HOLDER.firstName}}}`,
        )
        .expect(400);
      expect(res.body.errorCode).toBe('REQUEST_NOT_PROCESSED');

      // Esta solicitud no deja log propio: el JSON se rechaza antes del middleware de pino. Una precarga
      // después marca el final: cuando aparece su log, ya se escribió todo lo anterior.
      await lookup('CC', '99887766').expect(200);
      await expectCleanLogs('GET', LOOKUP_ROUTE, 200, undefined, ['99887766']);
    });
  });

  describe('la precarga del titular (E), con el documento en la consulta', () => {
    it('encuentra al titular: la respuesta trae sus datos; el log, el patrón de la ruta sin la consulta', async () => {
      await occupy(ROOM_201.id, '201');

      const res = await lookup(
        HOLDER.documentType,
        HOLDER.documentNumber,
      ).expect(200);

      // La respuesta sí los trae: así se sabe que se revisa una precarga con datos.
      expect(res.body).toEqual({ found: true, guest: HOLDER });
      await expectCleanLogs('GET', LOOKUP_ROUTE, 200);
    });

    it('un documento sin reservas (found: false)', async () => {
      await lookup('CC', '99887766').expect(200);

      await expectCleanLogs('GET', LOOKUP_ROUTE, 200, undefined, ['99887766']);
    });

    it('un documento con puntos (INVALID_CHARACTERS)', async () => {
      await lookup('CC', '1144.093.552').expect(400);

      await expectCleanLogs('GET', LOOKUP_ROUTE, 400, 'INVALID_CHARACTERS', [
        '1144.093.552',
      ]);
    });
  });
});
