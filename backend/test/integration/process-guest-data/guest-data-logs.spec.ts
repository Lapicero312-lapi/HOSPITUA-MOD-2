import { Writable } from 'node:stream';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
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
import {
  RESERVATION_REPOSITORY,
  type ReservationRepository,
} from '../../../src/application/ports/out/reservation.repository.js';
import type { GuestPayload } from '../../../src/application/use-cases/process-guest-data/ports/in/register-guest-movements.port.js';
import { configureApp } from '../../../src/configure-app.js';
import type { Reservation } from '../../../src/domain/reservation/reservation.js';
import {
  deadLetterQueue,
  EVENTS_EXCHANGE,
  INBOUND_QUEUES,
} from '../../../src/infrastructure/config/rabbitmq.topology.js';
import { pinoHttpOptions } from '../../../src/infrastructure/shared/logging.options.js';
import { aDirectReservation } from '../../support/builders.js';
import { integrationEnv, truncateAllTables } from '../support/database.js';

/**
 * T020 de `process-guest-data`: ningún log escribe el documento ni la fecha de nacimiento de un huésped
 * (NFR-002). La aplicación completa, con RabbitMQ y PostgreSQL reales y sus logs como en producción
 * (`main.ts`: nestjs-pino recibe todo lo que se escribe con el `Logger` de Nest), pero en el nivel más bajo
 * (`trace`), para que ningún log quede sin revisar, y dirigidos a la prueba. También se recoge lo que se
 * escriba con `console`. Se recorre lo que toca esos datos:
 * - el registro, por las colas, como lo envía el Módulo 1: el Check-In, el Check-Out, el huésped omitido,
 *   la salida sin entrada y el payload que el consumidor manda a la dead-letter;
 * - la vista, por HTTP: C1 buscando por documento, C2 con el documento en la ruta y sus errores, con el
 *   log de cada petición.
 */

const CHECK_IN = INBOUND_QUEUES.CHECK_IN;
const CHECK_OUT = INBOUND_QUEUES.CHECK_OUT;

/**
 * John, del mensaje de Check-In del plan de `update-reservation`; Lukas, Daniela e Hiroshi, de los
 * movimientos de la vista de huéspedes del wireframe, con sus datos tal cual. Ana, la otra huésped del
 * plan, no sirve aquí: su documento (`123`) también puede aparecer dentro de un UUID o de una hora.
 */
const JOHN: GuestPayload = {
  firstName: 'John',
  lastName: 'Smith',
  documentType: 'PAS',
  documentNumber: 'X99',
  birthDate: '1990-05-12',
  nationality: 'Estados Unidos',
  originPlace: 'Miami, Estados Unidos',
  destinationPlace: 'Cartagena, Colombia',
};
const LUKAS: GuestPayload = {
  firstName: 'Lukas',
  lastName: 'Becker',
  documentType: 'PAS',
  documentNumber: 'C4X8R21K',
  birthDate: '1991-07-02',
  nationality: 'Alemania',
  originPlace: 'Berlín, Alemania',
  destinationPlace: 'Medellín, Colombia',
};
const DANIELA: GuestPayload = {
  firstName: 'Daniela',
  lastName: 'Cárdenas Ruiz',
  documentType: 'CC',
  documentNumber: '52118904',
  birthDate: '1992-04-17',
  nationality: 'Colombia',
};
const HIROSHI: GuestPayload = {
  firstName: 'Hiroshi',
  lastName: 'Tanaka',
  documentType: 'PAS',
  documentNumber: 'JP0098231',
  birthDate: '1984-03-11',
  nationality: 'Japón',
  originPlace: 'Tokio, Japón',
  destinationPlace: 'Cartagena, Colombia',
};

/** Lo que NFR-002 no deja escribir en los logs: el documento y la fecha de nacimiento de cada huésped. */
const PERSONAL_DATA = [JOHN, LUKAS, DANIELA, HIROSHI].flatMap((guest) => [
  guest.documentNumber,
  guest.birthDate,
]);

const CHECK_IN_DATE = '2026-11-10';
const CHECK_OUT_DATE = '2026-11-12';

/** Una línea del log de pino (JSON); las de cada petición traen `req`, `route` y `res`. */
type LogLine = {
  msg: string;
  req?: { method: string; client: string | null };
  route?: string | null;
  res?: { statusCode: number; errorCode?: string };
};

describe('Logs sin documento ni fecha de nacimiento de los huéspedes (NFR-002, T020)', () => {
  let app: INestApplication<App>;
  let connection: AmqpConnection;
  let dataSource: DataSource;
  let reservations: ReservationRepository;
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

  /** Espera a que el log tenga `text`: el mensaje ya se procesó. */
  const waitForLog = (text: string) =>
    vi.waitFor(() => expect(allLogs()).toContain(text), {
      timeout: 15_000,
      interval: 50,
    });

  const expectNoPersonalData = () => {
    const logs = allLogs();
    for (const value of PERSONAL_DATA) {
      expect(logs).not.toContain(value);
    }
  };

  /** Un mensaje de Check-In o de Check-Out del contrato A para la habitación de la reserva. */
  const aNotification = (
    movementType: 'ENTRY' | 'DEPARTURE',
    guests: unknown[],
  ) => ({
    messageId: crypto.randomUUID(),
    sequenceNumber: 1,
    reservationRef: reservation.reservationRef,
    roomId: reservation.rooms[0].roomId,
    movementType,
    movementDate: movementType === 'ENTRY' ? CHECK_IN_DATE : CHECK_OUT_DATE,
    guests,
  });

  const publishCheckIn = (message: unknown) =>
    connection.publish(EVENTS_EXCHANGE, CHECK_IN.routingKey, message, {
      persistent: true,
    });
  const publishCheckOut = (message: unknown) =>
    connection.publish(EVENTS_EXCHANGE, CHECK_OUT.routingKey, message, {
      persistent: true,
    });

  const checkIn = async (guests: unknown[]) => {
    await publishCheckIn(aNotification('ENTRY', guests));
    await waitForLog('Check-In aplicado');
  };
  const checkOut = async (guests: unknown[]) => {
    await publishCheckOut(aNotification('DEPARTURE', guests));
    await waitForLog('Check-Out aplicado');
  };

  const messageCount = async (queue: string) =>
    (await connection.channel.checkQueue(queue)).messageCount;

  beforeAll(async () => {
    // AppConfigModule lee el entorno al importarse: AppModule se importa después de asignarlo.
    Object.assign(process.env, { NODE_ENV: 'test', ...integrationEnv() });
    const { AppModule } = await import('../../../src/app.module.js');
    const destination = new Writable({
      write(chunk: Buffer, _encoding, done) {
        written.push(chunk.toString());
        done();
      },
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PARAMS_PROVIDER_TOKEN)
      .useValue({ pinoHttp: [pinoHttpOptions('trace'), destination] })
      .compile();
    // Como `main.ts`: todo lo que se escribe con el Logger de Nest pasa por nestjs-pino.
    app = moduleRef.createNestApplication({ bufferLogs: true });
    app.useLogger(app.get(Logger));
    configureApp(app);
    await app.init();
    connection = app.get(AmqpConnection);
    dataSource = app.get(DataSource);
    reservations = app.get<ReservationRepository>(RESERVATION_REPOSITORY);
    // Los consumidores se suscriben cuando hay conexión, sin que el arranque los espere.
    await vi.waitFor(
      async () => {
        for (const queue of [CHECK_IN.name, CHECK_OUT.name]) {
          expect(
            (await connection.channel.checkQueue(queue)).consumerCount,
          ).toBe(1);
        }
      },
      { timeout: 15_000, interval: 100 },
    );
  });

  afterAll(async () => {
    if (dataSource) {
      await truncateAllTables(dataSource);
    }
    await app?.close();
  });

  beforeEach(async () => {
    for (const queue of [CHECK_IN.name, CHECK_OUT.name]) {
      await connection.channel.purgeQueue(queue);
      await connection.channel.purgeQueue(deadLetterQueue(queue));
    }
    await truncateAllTables(dataSource);
    reservation = await reservations.insert(
      aDirectReservation({
        status: 'ACTIVE',
        startDate: CHECK_IN_DATE,
        endDate: CHECK_OUT_DATE,
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

  describe('el registro, por las colas', () => {
    it('Check-In: el log del Check-In aplicado no trae los documentos ni las fechas de nacimiento del mensaje', async () => {
      await checkIn([JOHN, DANIELA]);

      expect(allLogs()).toContain('2 huéspedes recibidos, 2 registrados');
      expectNoPersonalData();
    });

    it('Check-Out: tampoco el del Check-Out aplicado', async () => {
      await checkIn([JOHN, DANIELA]);

      await checkOut([JOHN, DANIELA]);

      expectNoPersonalData();
    });

    it('huésped omitido: la alerta del huésped sin fecha de nacimiento no trae su documento', async () => {
      const { birthDate: _birthDate, ...hiroshiWithoutBirthDate } = HIROSHI;

      await checkIn([JOHN, hiroshiWithoutBirthDate, DANIELA]);

      expect(allLogs()).toContain('Se omitió al huésped 2 de la notificación');
      expectNoPersonalData();
    });

    it('salida sin entrada: el aviso no trae los datos del huésped que sale sin haber entrado', async () => {
      await checkIn([JOHN]);

      await checkOut([JOHN, LUKAS]);

      expect(allLogs()).toContain(
        'Se registró la salida del huésped 2 de la notificación',
      );
      expectNoPersonalData();
    });

    it.each([
      [
        'Check-In sin reservationRef',
        CHECK_IN,
        () => {
          const { reservationRef: _ref, ...withoutRef } = aNotification(
            'ENTRY',
            [JOHN, DANIELA],
          );
          return Buffer.from(JSON.stringify(withoutRef));
        },
      ],
      [
        'Check-In con caracteres no válidos en el documento',
        CHECK_IN,
        () =>
          Buffer.from(
            JSON.stringify(
              aNotification('ENTRY', [
                { ...JOHN, documentNumber: `${JOHN.documentNumber};` },
                DANIELA,
              ]),
            ),
          ),
      ],
      [
        'Check-In ilegible (el JSON llega cortado)',
        CHECK_IN,
        () =>
          Buffer.from(
            JSON.stringify(aNotification('ENTRY', [JOHN, DANIELA])).slice(
              0,
              -3,
            ),
          ),
      ],
      [
        'Check-Out con caracteres no válidos en el documento',
        CHECK_OUT,
        () =>
          Buffer.from(
            JSON.stringify(
              aNotification('DEPARTURE', [
                JOHN,
                { ...DANIELA, documentNumber: `${DANIELA.documentNumber}<` },
              ]),
            ),
          ),
      ],
    ])(
      'payload rechazado (%s): va a la dead-letter y su log no trae los datos de los huéspedes del mensaje',
      async (_case, queue, content) => {
        connection.channel.publish(
          EVENTS_EXCHANGE,
          queue.routingKey,
          content(),
          { persistent: true, contentType: 'application/json' },
        );

        await vi.waitFor(
          async () =>
            expect(await messageCount(deadLetterQueue(queue.name))).toBe(1),
          { timeout: 15_000, interval: 50 },
        );
        await waitForLog(
          `Mensaje inválido en ${queue.name}: va a la dead-letter sin reintentos`,
        );
        expectNoPersonalData();
      },
    );
  });

  describe('la vista, por HTTP', () => {
    const GUEST_ROUTE =
      '/api/reservations/:reservationRef/guests/:documentNumber';

    beforeEach(async () => {
      await checkIn([JOHN, DANIELA]);
      await checkOut([JOHN, DANIELA]);
      written = [];
    });

    it.each([
      [
        'C1 buscando el documento de John',
        () => '/api/guest-stays?search=X99',
        '/api/guest-stays',
        200,
        undefined,
      ],
      [
        'C1 buscando el documento de Daniela',
        () => '/api/guest-stays?search=52118904',
        '/api/guest-stays',
        200,
        undefined,
      ],
      [
        'C2 con el documento de John en la ruta',
        () => `/api/reservations/${reservation.reservationRef}/guests/X99`,
        GUEST_ROUTE,
        200,
        undefined,
      ],
      [
        'C2 con un documento que no está en la reserva (GUEST_NOT_FOUND)',
        () => `/api/reservations/${reservation.reservationRef}/guests/C4X8R21K`,
        GUEST_ROUTE,
        400,
        'GUEST_NOT_FOUND',
      ],
      [
        'C2 con un documento no válido (INVALID_DOCUMENT_NUMBER)',
        () => `/api/reservations/${reservation.reservationRef}/guests/X99%3B`,
        GUEST_ROUTE,
        400,
        'INVALID_DOCUMENT_NUMBER',
      ],
      [
        'C1 con una búsqueda no válida (INVALID_SEARCH)',
        () => '/api/guest-stays?search=52118904%3B',
        '/api/guest-stays',
        400,
        'INVALID_SEARCH',
      ],
    ])(
      '%s: el log de la petición trae el patrón de la ruta, no la ruta ni la consulta',
      async (_case, url, route, statusCode, errorCode) => {
        const res = await request(app.getHttpServer()).get(url());

        expect(res.status).toBe(statusCode);
        expect(res.body.errorCode).toBe(errorCode);
        // El log de la petición se escribe al terminar la respuesta.
        await vi.waitFor(() => expect(requestLogs()).toHaveLength(1), {
          timeout: 5_000,
          interval: 10,
        });
        expect(requestLogs()[0]).toMatchObject({
          req: { method: 'GET', client: null },
          route,
          res:
            errorCode === undefined
              ? { statusCode }
              : { statusCode, errorCode },
        });
        expectNoPersonalData();
      },
    );
  });
});
