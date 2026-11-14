import { randomUUID } from 'node:crypto';
import { createWriteStream, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { HttpService } from '@nestjs/axios';
import type { INestApplication } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import axios from 'axios';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { Logger, PARAMS_PROVIDER_TOKEN } from 'nestjs-pino';
import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { BookingRevision } from '../../src/application/integration/booking-revision.js';
import type { Room } from '../../src/application/integration/room.js';
import {
  CHANNEX_PORT,
  type ChannexPort,
} from '../../src/application/ports/out/channex.port.js';
import {
  PROCESS_BOOKING_FEED,
  type ProcessBookingFeed,
} from '../../src/application/use-cases/generate-ota-reservation/ports/in/process-booking-feed.port.js';
import { configureApp } from '../../src/configure-app.js';
import { AriDailyJob } from '../../src/infrastructure/in/jobs/ari-daily.job.js';
import { ChannexSetupJob } from '../../src/infrastructure/in/jobs/channex-setup.job.js';
import { ChannexSyncJob } from '../../src/infrastructure/in/jobs/channex-sync.job.js';
import { ChannexHttpAdapter } from '../../src/infrastructure/out/channex/channex-http.adapter.js';
import { pinoHttpOptions } from '../../src/infrastructure/shared/logging.options.js';
import {
  integrationEnv,
  openTestDataSource,
  truncateAllTables,
} from '../integration/support/database.js';

/** El único Channex contra el que corre: una reserva de Booking de producción no se toca. */
const STAGING_HOST = 'staging.channex.io';
/** El hotel de prueba de Booking conectado a la propiedad de staging (plan de `configure-ota`, A0). */
const BOOKING_TEST_HOTEL = '10485037';
/** El Módulo 1 sigue simulado y el Módulo 3 no se llama: solo Channex es el real. */
const MODULE1_BASE_URL = 'http://module1.test';
const MODULE3_BASE_URL = 'http://module3.test';
/** Las habitaciones que el Módulo 1 simulado informa por cada tipo de habitación de staging. */
const ROOMS_PER_TYPE = 3;
/** Cuánto espera cada paso a que quien corre la prueba haga su parte en Booking. */
const STEP_MINUTES = Number(process.env.STAGING_STEP_MINUTES ?? '15');
/** Cada cuánto se lee el feed mientras se espera. */
const POLL_MS = 10_000;
/** El log de la aplicación (pino, como en producción: sin la clave ni datos del titular), para revisar un paso que falla. */
const LOG_FILE = join(tmpdir(), 'hospitua-staging.log');

/**
 * Una variable de Channex como la lee la aplicación: la del sistema gana sobre las de `.env.test` y `.env`
 * (`AppConfigModule`). La prueba nunca la escribe en la salida.
 */
function channexSetting(name: string): string {
  const files = ['.env.test', '.env']
    .filter((file) => existsSync(file))
    .map((file) => parseEnv(readFileSync(file, 'utf8')));
  return (
    process.env[name] ||
    files
      .map((env) => env[name])
      .find((value) => value !== undefined && value !== '') ||
    ''
  );
}

const STAGING = {
  CHANNEX_BASE_URL:
    channexSetting('CHANNEX_BASE_URL') || `https://${STAGING_HOST}`,
  CHANNEX_API_KEY: channexSetting('CHANNEX_API_KEY'),
  CHANNEX_PROPERTY_ID: channexSetting('CHANNEX_PROPERTY_ID'),
};
const configured =
  STAGING.CHANNEX_API_KEY !== '' && STAGING.CHANNEX_PROPERTY_ID !== '';

/** Lo que se lee de una reserva para comparar con la revisión de Booking. */
type ReservationRow = {
  status: string;
  source: string;
  start_date: string;
  end_date: string;
  gross_amount: string;
  currency: string;
  commission_percentage: string;
  commission_amount: string;
  conflict_reason: string | null;
};

/** La comisión de un valor con el porcentaje de la agencia, con dos decimales. */
const commissionOf = (gross: string, percentage: string): string =>
  (
    Math.round(Math.round(Number(gross) * 100) * Number(percentage)) / 10_000
  ).toFixed(2);

/**
 * Lo que quien corre la prueba tiene que hacer, o lo que pasó. Nunca con datos del titular. Va directo a la
 * salida, en el momento: Vitest no muestra el `console.log` de una prueba que pasa.
 */
const say = (text: string) => {
  process.stdout.write(`\n[staging] ${text}\n\n`);
};

/**
 * La aplicación completa, con su log en `LOG_FILE` y sin las tareas programadas que envían a Channex:
 * `ChannexSyncJob` (disponibilidad y no-shows) y `AriDailyJob` (el envío de las 03:00). Así, aunque la corrida
 * dure más de una hora o pase por las 03:00, no envía nada a staging: la prueba solo dispara el ciclo del
 * feed. Como `startBookingFeedApp` de la integración, espera a que la configuración de Channex (A0) quede
 * lista.
 */
async function startStagingApp(): Promise<INestApplication> {
  const attempt = vi.spyOn(ChannexSetupJob.prototype, 'attempt');
  const { AppModule } = await import('../../src/app.module.js');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ChannexSyncJob)
    .useValue({})
    .overrideProvider(AriDailyJob)
    .useValue({})
    .overrideProvider(PARAMS_PROVIDER_TOKEN)
    .useValue({
      pinoHttp: [pinoHttpOptions('trace'), createWriteStream(LOG_FILE)],
    })
    .compile();
  const app = moduleRef.createNestApplication({ bufferLogs: true });
  app.useLogger(app.get(Logger));
  configureApp(app);
  await app.init();
  const setup = await (attempt.mock.results[0]?.value as Promise<string>);
  attempt.mockRestore();
  if (setup !== 'READY') {
    throw new Error(
      `La configuración de Channex staging no quedó lista (${setup}). El motivo está en ${LOG_FILE}.`,
    );
  }
  return app;
}

const module1Rooms: Room[] = [];
const server = setupServer(
  // Como el Módulo 1, filtra por `categoryRoom` si viene en la consulta.
  http.get(`${MODULE1_BASE_URL}/api/rooms`, ({ request }) => {
    const category = new URL(request.url).searchParams.get('categoryRoom');
    return HttpResponse.json(
      module1Rooms.filter(
        ({ categoryRoom }) => category === null || categoryRoom === category,
      ),
    );
  }),
  http.get(`${MODULE1_BASE_URL}/api/rooms/:roomId/maintenances`, ({ params }) =>
    HttpResponse.json({
      roomId: params.roomId,
      available: true,
      conflicts: [],
    }),
  ),
);

/**
 * T012 de `generate-ota-reservation`: una reserva de prueba en el hotel de Booking conectado a Channex
 * staging, creada, cambiada y cancelada, llega al Módulo 2 por el feed real (A1) y se confirma (A2). Revisa
 * lo de "Pruebas por escenario": el escenario 1 de la historia 1 y los escenarios 1 y 3 de la historia 2.
 *
 * Es una corrida guiada: `pnpm test:staging` (Docker abierto) arranca la aplicación con PostgreSQL y RabbitMQ
 * de prueba, el Módulo 1 simulado y el Channex de staging con la configuración de quien la corre (las
 * variables del sistema o `backend/.env`). Cada paso dice qué hacer en Booking y espera hasta
 * `STAGING_STEP_MINUTES` (15 por defecto) a que llegue la revisión. Sin la clave o la propiedad de Channex,
 * se salta. Solo corre contra `staging.channex.io`.
 *
 * Antes de correrla, la demo (la única copia del Módulo 2 conectada a Channex) tiene que estar pausada y el
 * feed vacío: si la demo lee el feed durante la corrida, confirma las revisiones y la prueba ya no las ve. Si
 * al empezar el feed tiene revisiones pendientes, son de la demo: la prueba se detiene sin procesarlas ni
 * confirmarlas.
 *
 * Para no cambiar la propiedad de staging, el Módulo 1 simulado informa 3 habitaciones por cada tipo de
 * habitación que ya existe en Channex, y la relación de cada tipo se guarda antes de arrancar con esa misma
 * cantidad y capacidad: `SyncRoomTypes` no tiene nada que actualizar. La prueba solo dispara el ciclo del
 * feed (`ProcessBookingFeed`); las tareas programadas que envían a Channex no corren (`startStagingApp`).
 */
describe.skipIf(!configured)(
  'generate-ota-reservation contra Channex staging: una reserva de prueba de Booking creada, cambiada y cancelada (T012)',
  () => {
    let dataSource: DataSource;
    let app: INestApplication;
    let feed: ProcessBookingFeed;
    let readFeed: ChannexPort['fetchBookingFeed'];
    /** Las revisiones que leyó el feed, por id. */
    const seen = new Map<string, BookingRevision>();
    /** La revisión `new` de la reserva de esta prueba, y la fila de su último paso. */
    let created: BookingRevision | undefined;
    let last: ReservationRow | undefined;

    const reservationOf = async (code: string): Promise<ReservationRow[]> =>
      dataSource.query(
        `SELECT status, source, to_char(start_date, 'YYYY-MM-DD') AS start_date,
                to_char(end_date, 'YYYY-MM-DD') AS end_date, gross_amount::text, currency,
                commission_percentage::text, commission_amount::text, conflict_reason
         FROM reservation WHERE external_confirmation_code = $1`,
        [code],
      );

    const roomsOf = (
      code: string,
    ): Promise<{ assigned: boolean; stay_status: string }[]> =>
      dataSource.query(
        `SELECT rr.room_id IS NOT NULL AS assigned, rr.stay_status
         FROM reservation_room rr JOIN reservation r ON r.id = rr.reservation_id
         WHERE r.external_confirmation_code = $1`,
        [code],
      );

    const revisionRow = async (
      id: string,
    ): Promise<
      { status: string; result: string; acked: boolean } | undefined
    > =>
      (
        await dataSource.query(
          `SELECT status, result, acked_at IS NOT NULL AS acked
           FROM ota_booking_revision WHERE revision_id = $1`,
          [id],
        )
      )[0];

    /** Si la revisión sigue en el feed de Channex (sin confirmar). */
    const stillInFeed = async (id: string): Promise<boolean> =>
      (await readFeed(1)).revisions.some((revision) => revision.id === id);

    /**
     * Lee y procesa el feed cada `POLL_MS` hasta que una revisión cumpla `match` y el Módulo 2 la haya
     * procesado, o se acabe el tiempo del paso.
     */
    async function processed(
      what: string,
      match: (revision: BookingRevision) => boolean,
    ): Promise<BookingRevision> {
      const deadline = Date.now() + STEP_MINUTES * 60_000;
      for (;;) {
        await feed.run();
        const arrived = [...seen.values()].filter(match);
        for (const revision of arrived) {
          if ((await revisionRow(revision.id)) !== undefined) {
            say(
              `Llegó ${what} (código de Booking ${revision.otaReservationCode ?? 'sin código'}).`,
            );
            return revision;
          }
        }
        if (Date.now() > deadline) {
          throw new Error(
            arrived.length > 0
              ? `${what} llegó al feed pero el Módulo 2 no la procesó en ${STEP_MINUTES} minutos. El motivo está en ${LOG_FILE}.`
              : `No llegó ${what} al feed de Channex en ${STEP_MINUTES} minutos.`,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      }
    }

    const ofThisBooking =
      (status: BookingRevision['status']) => (revision: BookingRevision) =>
        revision.status === status && revision.bookingId === created?.bookingId;

    beforeAll(async () => {
      if (new URL(STAGING.CHANNEX_BASE_URL).hostname !== STAGING_HOST) {
        throw new Error(
          `La prueba solo corre contra ${STAGING_HOST}: CHANNEX_BASE_URL apunta a otro Channex.`,
        );
      }
      // Antes de importar AppModule: AppConfigModule lee el entorno al importarse. Las tareas que envían a
      // Channex no corren (`startStagingApp`); el intervalo largo queda de respaldo.
      Object.assign(process.env, {
        NODE_ENV: 'test',
        ...integrationEnv(),
        ...STAGING,
        CHANNEX_SYNC_INTERVAL_SECONDS: '3600',
        MODULE1_BASE_URL,
        MODULE3_BASE_URL,
      });
      // Solo sale a la red lo que va a Channex staging; cualquier otra llamada sin simular falla.
      server.listen({
        onUnhandledRequest: (request, print) => {
          if (new URL(request.url).hostname !== STAGING_HOST) {
            print.error();
          }
        },
      });

      const staging = new ChannexHttpAdapter(
        new HttpService(axios.create({ timeout: 15_000 })),
        {
          get: (name: string) => process.env[name],
        } as unknown as ConfigService,
      );
      // Lo pendiente en el feed es de la demo: se detiene sin leerlo con la aplicación ni confirmarlo.
      const { total: pending } = await staging.fetchBookingFeed(1);
      if (pending > 0) {
        throw new Error(
          `El feed de Channex staging tiene ${pending === 1 ? 'una revisión pendiente' : `${pending} revisiones pendientes`} de la demo. La prueba se detuvo sin procesar ni confirmar nada: deja que la demo termine, páusala y vuelve a correr la prueba con el feed vacío.`,
        );
      }
      say(
        'El feed de Channex staging está vacío. Mientras dure la prueba, la demo tiene que seguir pausada: si lee el feed, confirma las revisiones y la prueba ya no las ve.',
      );

      // Los tipos de habitación que ya tiene la propiedad (A1 de `configure-ota`), con su relación guardada.
      const listed = await staging.listRoomTypes();
      // Un tipo por nombre, como lo adopta SyncRoomTypes: con dos del mismo nombre, el segundo no se usa.
      const types = listed.filter(
        (type, index) =>
          listed.findIndex(({ title }) => title === type.title) === index,
      );
      if (types.length === 0) {
        throw new Error(
          'La propiedad de Channex staging no tiene tipos de habitación: falta su puesta en marcha (configure-ota).',
        );
      }
      dataSource = await openTestDataSource();
      await truncateAllTables(dataSource);
      types.forEach((type, index) => {
        for (let room = 1; room <= ROOMS_PER_TYPE; room += 1) {
          module1Rooms.push({
            id: randomUUID(),
            roomNumber: String((index + 1) * 100 + room),
            categoryRoom: type.title,
            maxCapacity: type.defaultOccupancy,
          });
        }
      });
      for (const type of types) {
        await dataSource.query(
          `INSERT INTO ota_room_type_mapping (channex_room_type_id, category_room, count_of_rooms, occupancy)
           VALUES ($1, $2, $3, $4)`,
          [type.id, type.title, ROOMS_PER_TYPE, type.defaultOccupancy],
        );
      }

      app = await startStagingApp();
      feed = app.get<ProcessBookingFeed>(PROCESS_BOOKING_FEED);
      const channex = app.get<ChannexPort>(CHANNEX_PORT);
      readFeed = channex.fetchBookingFeed.bind(channex);
      vi.spyOn(channex, 'fetchBookingFeed').mockImplementation(async (page) => {
        const read = await readFeed(page);
        read.revisions.forEach((revision) => seen.set(revision.id, revision));
        return read;
      });
    });

    afterAll(async () => {
      vi.restoreAllMocks();
      server.close();
      await app?.close();
      await dataSource?.destroy();
    });

    it(
      'paso 1: la reserva nueva llega ACTIVE, con su código, sus fechas, su valor y su comisión, la habitación asignada y el ack',
      async () => {
        say(
          `Paso 1 de 3: crea una reserva de prueba en el hotel ${BOOKING_TEST_HOTEL} de Booking, de una habitación y sin pasar su capacidad (tarjeta 4111 1111 1111 1111). Espero hasta ${STEP_MINUTES} minutos.`,
        );
        const revision = await processed(
          'la reserva nueva',
          (candidate) => candidate.status === 'new',
        );
        created = revision;
        const code = revision.otaReservationCode ?? '';

        const [reservation] = await reservationOf(code);
        expect(reservation).toMatchObject({
          status: 'ACTIVE',
          source: 'OTA',
          start_date: revision.arrivalDate,
          end_date: revision.departureDate,
          gross_amount: revision.amount?.amountWithCents,
          currency: revision.amount?.currency,
          conflict_reason: null,
        });
        // La primera reserva de la agencia fija su porcentaje con la comisión que informa Booking.
        expect(Number(reservation.commission_percentage)).toBeCloseTo(
          (Number(revision.otaCommission?.amount) /
            Number(revision.amount?.amount)) *
            100,
          1,
        );
        expect(reservation.commission_amount).toBe(
          commissionOf(
            reservation.gross_amount,
            reservation.commission_percentage,
          ),
        );
        expect(await roomsOf(code)).toEqual(
          revision.rooms.map(() => ({
            assigned: true,
            stay_status: 'EXPECTED',
          })),
        );
        expect(await revisionRow(revision.id)).toEqual({
          status: 'new',
          result: 'APPLIED',
          acked: true,
        });
        expect(await stillInFeed(revision.id)).toBe(false);
        last = reservation;
      },
      STEP_MINUTES * 60_000 + 60_000,
    );

    it(
      'paso 2: el cambio de fechas deja las fechas, el valor y la comisión nuevos con el mismo porcentaje, y el ack',
      async () => {
        if (created === undefined || last === undefined) {
          throw new Error('Falta el paso 1: no hay reserva que cambiar.');
        }
        say(
          `Paso 2 de 3: en Booking, cambia la fecha de salida de la reserva ${created.otaReservationCode}. Espero hasta ${STEP_MINUTES} minutos.`,
        );
        const revision = await processed(
          'el cambio',
          ofThisBooking('modified'),
        );
        const code = created.otaReservationCode ?? '';

        const [reservation] = await reservationOf(code);
        expect(reservation).toMatchObject({
          status: 'ACTIVE',
          start_date: revision.arrivalDate,
          end_date: revision.departureDate,
          gross_amount: revision.amount?.amountWithCents,
          currency: revision.amount?.currency,
          commission_percentage: last.commission_percentage,
          commission_amount: commissionOf(
            revision.amount?.amountWithCents ?? '',
            last.commission_percentage,
          ),
          conflict_reason: null,
        });
        expect(await roomsOf(code)).toEqual(
          revision.rooms.map(() => ({
            assigned: true,
            stay_status: 'EXPECTED',
          })),
        );
        expect(await revisionRow(revision.id)).toEqual({
          status: 'modified',
          result: 'APPLIED',
          acked: true,
        });
        expect(await stillInFeed(revision.id)).toBe(false);
        last = reservation;
      },
      STEP_MINUTES * 60_000 + 60_000,
    );

    it(
      'paso 3: la cancelación deja la reserva CANCELLED con su Cancellation de OTA_API, la comisión intacta y el ack',
      async () => {
        if (created === undefined || last === undefined) {
          throw new Error(
            'Falta el paso 1 o el 2: no hay reserva que cancelar.',
          );
        }
        say(
          `Paso 3 de 3: cancela en Booking la reserva ${created.otaReservationCode}. Espero hasta ${STEP_MINUTES} minutos.`,
        );
        const revision = await processed(
          'la cancelación',
          ofThisBooking('cancelled'),
        );
        const code = created.otaReservationCode ?? '';

        const [reservation] = await reservationOf(code);
        expect(reservation).toMatchObject({
          status: 'CANCELLED',
          commission_percentage: last.commission_percentage,
          commission_amount: last.commission_amount,
        });
        expect(
          await dataSource.query(
            `SELECT c.channel, c.processed_by
             FROM cancellation c JOIN reservation r ON r.id = c.reservation_id
             WHERE r.external_confirmation_code = $1`,
            [code],
          ),
        ).toEqual([{ channel: 'OTA_API', processed_by: 'Booking.com' }]);
        expect(await revisionRow(revision.id)).toEqual({
          status: 'cancelled',
          result: 'APPLIED',
          acked: true,
        });
        expect(await stillInFeed(revision.id)).toBe(false);
        say(
          'Listo: la reserva de prueba se creó, se cambió y se canceló en el Módulo 2.',
        );
      },
      STEP_MINUTES * 60_000 + 60_000,
    );
  },
);
