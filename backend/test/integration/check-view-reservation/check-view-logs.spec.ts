import { Writable } from 'node:stream';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
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
import {
  GENERATE_DAILY_LIST,
  type GenerateDailyList,
} from '../../../src/application/use-cases/check-view-reservation/ports/in/generate-daily-list.port.js';
import { configureApp } from '../../../src/configure-app.js';
import type { Reservation } from '../../../src/domain/reservation/reservation.js';
import { pinoHttpOptions } from '../../../src/infrastructure/shared/logging.options.js';
import {
  aDirectReservation,
  aDirectRoom,
  aGuest,
} from '../../support/builders.js';
import { integrationEnv, truncateAllTables } from '../support/database.js';

/**
 * T035 de `check-view-reservation`: ningún log escribe datos personales del titular (NFR-003; plan base,
 * "Logs y correlación": "de la solicitud solo se registran el método, el patrón de la ruta y `X-Client`;
 * nunca cabeceras, cuerpo ni consulta"). El titular sale en las respuestas del listado (C1) y del detalle (C3),
 * llega en la consulta de la búsqueda (`search`) y va en la lista del día
 * para el Módulo 1. Se recorre cada camino, los que terminan bien y los que fallan, y se revisa todo lo que
 * se escribió.
 *
 * La aplicación completa, con PostgreSQL y RabbitMQ reales y sus logs como en producción, pero en el nivel
 * más bajo y dirigidos a la prueba; también se recoge lo que se escriba con `console`.
 */

/** Un día operativo propio de esta prueba; la reserva llega ese día. */
const TODAY = '2032-04-01';
const clock: Clock = {
  today: () => TODAY,
  now: () => new Date('2032-04-01T15:00:00.000Z'),
};

/** El titular de la reserva de la prueba. */
const HOLDER = {
  firstName: 'Mariana',
  lastName: 'Restrepo',
  documentType: 'CC' as const,
  documentNumber: '1098765432',
  nationality: 'Colombia',
  contactPhone: '+57 311 222 3344',
  contactEmail: 'mariana@correo.com',
};

/** Lo que no puede salir en un log: todos los datos del titular salvo su tipo de documento. */
const PERSONAL_DATA = [
  HOLDER.firstName,
  HOLDER.lastName,
  HOLDER.documentNumber,
  HOLDER.nationality,
  HOLDER.contactPhone,
  HOLDER.contactEmail,
];

/** Una línea del log de pino (JSON); las de cada solicitud traen `req`, `route` y `res`. */
type LogLine = {
  level: number;
  msg: string;
  req?: { method: string; client: string | null };
  route?: string | null;
  res?: { statusCode: number; errorCode?: string };
};

const LIST_ROUTE = '/api/reservations';
const DETAIL_ROUTE = '/api/reservations/:reservationRef';
const SUMMARY_ROUTE = '/api/reservations/day-summary';

const server = setupServer();

describe('Consultar reservas: los logs no escriben datos personales del titular (T035, NFR-003)', () => {
  let app: INestApplication<App>;
  let reservation: Reservation;
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
   * ruta, el estado y el código de error, y que en todo lo escrito no hay ningún dato del titular.
   */
  async function expectCleanLogs(
    route: string,
    statusCode: number,
    errorCode?: string,
  ): Promise<void> {
    await vi.waitFor(() => expect(requestLogs()).toHaveLength(1), {
      timeout: 5_000,
      interval: 10,
    });
    expect(requestLogs()[0]).toMatchObject({
      req: { method: 'GET' },
      route,
      res: errorCode === undefined ? { statusCode } : { statusCode, errorCode },
    });
    expectNoPersonalData();
  }

  function expectNoPersonalData(): void {
    const logs = allLogs();
    for (const value of PERSONAL_DATA) {
      expect(logs).not.toContain(value);
    }
  }

  const get = (path: string, client = 'RECEPTIONIST') =>
    request(app.getHttpServer()).get(path).set('X-Client', client);

  beforeAll(async () => {
    // AppConfigModule lee el entorno al importarse: AppModule se importa después de asignarlo.
    Object.assign(process.env, { NODE_ENV: 'test', ...integrationEnv() });
    const { AppModule } = await import('../../../src/app.module.js');
    // La aplicación completa también llama a Channex y al Módulo 1 al arrancar; esta prueba no los usa.
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
  });

  beforeEach(async () => {
    await truncateAllTables(app.get(DataSource));
    reservation = await app
      .get<ReservationRepository>(RESERVATION_REPOSITORY)
      .insert(
        aDirectReservation({
          startDate: TODAY,
          endDate: '2032-04-03',
          guest: aGuest(HOLDER),
          rooms: [aDirectRoom({ roomNumber: '201' })],
        }),
      );
    written = [];
    consoleLines = [];
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        consoleLines.push(args.map(String).join(' '));
      });
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    server.close();
    await app?.close();
  });

  describe('el listado (C1)', () => {
    it('la respuesta trae al titular; el log, el patrón de la ruta sin la consulta', async () => {
      const res = await get(
        `${LIST_ROUTE}?dateFrom=${TODAY}&dateTo=${TODAY}`,
      ).expect(200);

      // La respuesta sí lo trae: así se sabe que se revisa un listado con datos.
      expect(JSON.stringify(res.body)).toContain(HOLDER.documentNumber);
      await expectCleanLogs(LIST_ROUTE, 200);
    });

    it.each([
      ['el documento', HOLDER.documentNumber],
      ['el nombre', HOLDER.lastName],
    ])(
      'la búsqueda por %s: el texto buscado no sale en el log',
      async (_, search) => {
        await get(`${LIST_ROUTE}?search=${encodeURIComponent(search)}`).expect(
          200,
        );

        await expectCleanLogs(LIST_ROUTE, 200);
      },
    );

    it('una búsqueda rechazada (INVALID_RESERVATION_CODE): el log trae el código, sin el texto', async () => {
      await get(
        `${LIST_ROUTE}?search=${encodeURIComponent(`${HOLDER.lastName} ${HOLDER.firstName}`)}`,
      ).expect(400);

      await expectCleanLogs(LIST_ROUTE, 400, 'INVALID_RESERVATION_CODE');
    });
  });

  it('el resumen del día (C2)', async () => {
    await get(SUMMARY_ROUTE).expect(200);

    await expectCleanLogs(SUMMARY_ROUTE, 200);
  });

  describe('el detalle (C3)', () => {
    it('la respuesta trae al titular completo; el log, no', async () => {
      const res = await get(
        `${LIST_ROUTE}/${reservation.reservationRef}`,
      ).expect(200);

      expect(res.body.guest).toMatchObject({
        contactEmail: HOLDER.contactEmail,
        contactPhone: HOLDER.contactPhone,
      });
      await expectCleanLogs(DETAIL_ROUTE, 200);
    });

    it('una reserva que no existe (RESERVATION_NOT_FOUND)', async () => {
      await get(`${LIST_ROUTE}/RSV-FFFFFFFF`).expect(400);

      await expectCleanLogs(DETAIL_ROUTE, 400, 'RESERVATION_NOT_FOUND');
    });
  });

  it('la consulta del Módulo 1 (C5), que no trae al titular', async () => {
    const res = await get(
      `${LIST_ROUTE}?dateFrom=${TODAY}&dateTo=${TODAY}`,
      'MODULE1',
    ).expect(200);

    expect(res.body.items[0].reservationRef).toBe(reservation.reservationRef);
    await expectCleanLogs(LIST_ROUTE, 200);
  });

  it('la lista del día para el Módulo 1: el mensaje guardado trae al titular; el log, no', async () => {
    await app.get<GenerateDailyList>(GENERATE_DAILY_LIST).execute(TODAY);

    const [{ payload }]: { payload: object }[] = await app
      .get(DataSource)
      .query(
        `SELECT payload FROM daily_list_message
         WHERE operational_date = $1 AND message_kind = 'LIST'`,
        [TODAY],
      );
    // El mensaje sí lo trae: así se sabe que se revisa una lista con datos.
    expect(JSON.stringify(payload)).toContain(HOLDER.documentNumber);
    expectNoPersonalData();
  });
});
