import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import type { DataSource } from 'typeorm';
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
  CLOCK,
  type Clock,
} from '../../../../src/application/ports/out/clock.js';
import {
  OTA_BOOKING_REVISION_REPOSITORY,
  type OtaBookingRevisionRepository,
} from '../../../../src/application/ports/out/ota-booking-revision.repository.js';
import {
  RESERVATION_REPOSITORY,
  type ReservationRepository,
} from '../../../../src/application/ports/out/reservation.repository.js';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../../src/application/ports/out/transaction.js';
import {
  CLOSE_DAY,
  type CloseDay,
} from '../../../../src/application/use-cases/update-reservation/ports/in/close-day.port.js';
import { configureApp } from '../../../../src/configure-app.js';
import type { Reservation } from '../../../../src/domain/reservation/reservation.js';
import { ChannexSetupJob } from '../../../../src/infrastructure/in/jobs/channex-setup.job.js';
import { ChannexSyncJob } from '../../../../src/infrastructure/in/jobs/channex-sync.job.js';
import { anOtaReservation, otaTerms } from '../../../support/builders.js';
import {
  integrationEnv,
  openTestDataSource,
  truncateAllTables,
} from '../../support/database.js';

/** Channex simulado. La clave es de prueba: nunca se llama al Channex real. */
const CHANNEX_BASE_URL = 'http://channex.test';
const PROPERTY_ID = '716305c4-561a-4561-a187-7f5b8aeb5920';
const API_KEY = 'clave-de-prueba';

/** El `booking_id` de la revisión (ejemplo A1 del plan). */
const BOOKING_ID = 'cfa33f3b-bd32-4b90-8ef9-bde2bfe986cd';
const NO_SHOW_URL = `${CHANNEX_BASE_URL}/api/v1/bookings/${BOOKING_ID}/no_show`;

/** La reserva llegaba ayer; el cierre corre hoy a las 00:00:30 y la tarea de Channex después. */
const ARRIVAL = '2026-11-09';
const CLOSING_AT = new Date('2026-11-10T05:00:30.000Z');
const FIRST_CYCLE_AT = new Date('2026-11-10T05:01:00.000Z');
const SECOND_CYCLE_AT = new Date('2026-11-10T05:01:30.000Z');

const server = setupServer();

type ReportRow = {
  result: string;
  attempts: number;
  /** `reported_at` en milisegundos desde 1970: la consulta directa entrega el texto de la base. */
  reported_millis: number | null;
};

/** Lo que recibió Channex en cada reporte de no-show. */
type NoShowCall = { url: string; apiKey: string | null; body: unknown };

/**
 * Escenario 6 de la historia 2 de `generate-ota-reservation` (T011b; FR-011): el cierre del día pasa la
 * reserva de Booking a `NO_SHOW` y deja pendiente su reporte; `ChannexSyncJob` lo envía a Channex sin
 * cobrar penalidad (A3), y si Channex no responde, la reserva sigue en `NO_SHOW` y el reporte se reintenta.
 * Con la aplicación completa, PostgreSQL real y Channex simulado en HTTP (msw).
 */
describe('No-show reportado a Booking (generate-ota-reservation, historia 2, escenario 6; T011b)', () => {
  let dataSource: DataSource;
  let app: INestApplication;
  let now: Date;
  let calls: NoShowCall[];
  const clock: Clock = {
    now: () => now,
    today: () => now.toISOString().slice(0, 10),
  };

  /** Channex responde cada reporte de no-show con lo que diga `answer`. */
  function channexAnswersNoShow(answer: () => Response): void {
    server.use(
      http.post(NO_SHOW_URL, async ({ request }) => {
        calls.push({
          url: request.url,
          apiKey: request.headers.get('user-api-key'),
          body: await request.json(),
        });
        return answer();
      }),
    );
  }

  /** Un ciclo de `ChannexSyncJob` a la hora `at`, como lo dispara la tarea programada. */
  async function cycleAt(at: Date): Promise<void> {
    now = at;
    await expect(app.get(ChannexSyncJob).run()).resolves.toBe(true);
  }

  const reportRows = (): Promise<ReportRow[]> =>
    dataSource.query(
      `SELECT result, attempts,
              (extract(epoch FROM reported_at) * 1000)::float8 AS reported_millis
       FROM ota_no_show_report`,
    );

  const statusOf = async (reservation: Reservation): Promise<string> => {
    const [row]: { status: string }[] = await dataSource.query(
      'SELECT status FROM reservation WHERE id = $1',
      [reservation.id],
    );
    return row.status;
  };

  /**
   * La reserva de Booking que llegaba ayer, sin ningún Check-In, con la revisión `new` que la creó. La
   * agencia es la Booking.com que registró el arranque.
   */
  async function aBookingReservationFromYesterday(): Promise<Reservation> {
    const [{ id: otaId }]: { id: string }[] = await dataSource.query(
      `SELECT id::text FROM ota WHERE name = 'Booking.com'`,
    );
    const saved = await app
      .get<ReservationRepository>(RESERVATION_REPOSITORY)
      .insert(
        anOtaReservation(otaId, {
          startDate: ARRIVAL,
          endDate: '2026-11-11',
          ota: otaTerms(otaId, { externalConfirmationCode: '9996013801' }),
        }),
      );
    await app.get<TransactionRunner>(TRANSACTION_RUNNER).run((tx) =>
      app
        .get<OtaBookingRevisionRepository>(OTA_BOOKING_REVISION_REPOSITORY)
        .record(
          {
            revisionId: randomUUID(),
            otaId,
            bookingId: BOOKING_ID,
            status: 'new',
            reservationId: saved.id,
            result: 'APPLIED',
          },
          tx,
        ),
    );
    return saved;
  }

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    // Antes de importar AppModule: AppConfigModule lee el entorno al importarse. El intervalo largo evita
    // que la tarea corra sola durante la prueba; cada ciclo lo dispara la prueba.
    Object.assign(process.env, {
      NODE_ENV: 'test',
      ...integrationEnv(),
      CHANNEX_BASE_URL,
      CHANNEX_API_KEY: API_KEY,
      CHANNEX_PROPERTY_ID: PROPERTY_ID,
      CHANNEX_SYNC_INTERVAL_SECONDS: '3600',
    });
    // Una llamada a Channex sin respuesta simulada es un error de la prueba.
    server.listen({
      onUnhandledRequest: (sent, print) => {
        if (new URL(sent.url).origin === CHANNEX_BASE_URL) {
          print.error();
        }
      },
    });
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    calls = [];
    now = CLOSING_AT;
    server.use(
      // A0 de configure-ota: la propiedad está en la cuenta, así que el arranque queda listo.
      http.get(`${CHANNEX_BASE_URL}/api/v1/properties/options`, () =>
        HttpResponse.json({
          data: [
            {
              type: 'property',
              id: PROPERTY_ID,
              attributes: { id: PROPERTY_ID, title: 'Hotel de prueba' },
            },
          ],
        }),
      ),
      // El feed no trae revisiones: la prueba es del reporte del no-show.
      http.get(`${CHANNEX_BASE_URL}/api/v1/booking_revisions/feed`, () =>
        HttpResponse.json({
          meta: { total: 0, page: 1, limit: 100 },
          data: [],
        }),
      ),
    );
    const attempt = vi.spyOn(ChannexSetupJob.prototype, 'attempt');
    const { AppModule } = await import('../../../../src/app.module.js');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CLOCK)
      .useValue(clock)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    await expect(attempt.mock.results[0].value).resolves.toBe('READY');
    attempt.mockRestore();
  });

  afterEach(async () => {
    await app.close();
    server.resetHandlers();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    server.close();
    await truncateAllTables(dataSource);
    await dataSource.destroy();
    delete process.env.CHANNEX_BASE_URL;
    delete process.env.CHANNEX_API_KEY;
    delete process.env.CHANNEX_PROPERTY_ID;
    delete process.env.CHANNEX_SYNC_INTERVAL_SECONDS;
  });

  it('el cierre la pasa a NO_SHOW y deja el reporte pendiente; el ciclo de Channex lo envía sin penalidad y queda REPORTED', async () => {
    const reservation = await aBookingReservationFromYesterday();
    channexAnswersNoShow(() =>
      HttpResponse.json({ meta: { message: 'Success' } }),
    );

    await app.get<CloseDay>(CLOSE_DAY).execute(ARRIVAL);

    expect(await statusOf(reservation)).toBe('NO_SHOW');
    expect(await reportRows()).toEqual([
      { result: 'PENDING', attempts: 0, reported_millis: null },
    ]);
    expect(calls).toEqual([]);

    await cycleAt(FIRST_CYCLE_AT);

    expect(calls).toEqual([
      {
        url: NO_SHOW_URL,
        apiKey: API_KEY,
        body: { no_show_report: { waived_fees: true } },
      },
    ]);
    expect(await reportRows()).toEqual([
      {
        result: 'REPORTED',
        attempts: 1,
        reported_millis: FIRST_CYCLE_AT.getTime(),
      },
    ]);
    // Un ciclo más no lo vuelve a enviar.
    await cycleAt(SECOND_CYCLE_AT);
    expect(calls).toHaveLength(1);
  });

  it.each([
    ['responde 503', () => HttpResponse.json({}, { status: 503 })],
    ['no responde', () => HttpResponse.error()],
  ])(
    'si Channex %s, la reserva sigue en NO_SHOW y el reporte queda pendiente; el ciclo siguiente lo envía',
    async (_case, failure) => {
      const reservation = await aBookingReservationFromYesterday();
      await app.get<CloseDay>(CLOSE_DAY).execute(ARRIVAL);
      channexAnswersNoShow(failure);

      await cycleAt(FIRST_CYCLE_AT);

      expect(await statusOf(reservation)).toBe('NO_SHOW');
      expect(await reportRows()).toEqual([
        { result: 'PENDING', attempts: 1, reported_millis: null },
      ]);

      server.resetHandlers();
      server.use(
        http.get(`${CHANNEX_BASE_URL}/api/v1/booking_revisions/feed`, () =>
          HttpResponse.json({
            meta: { total: 0, page: 1, limit: 100 },
            data: [],
          }),
        ),
      );
      channexAnswersNoShow(() =>
        HttpResponse.json({ meta: { message: 'Success' } }),
      );
      await cycleAt(SECOND_CYCLE_AT);

      expect(await statusOf(reservation)).toBe('NO_SHOW');
      expect(await reportRows()).toEqual([
        {
          result: 'REPORTED',
          attempts: 2,
          reported_millis: SECOND_CYCLE_AT.getTime(),
        },
      ]);
    },
  );

  it.each([
    [404, 'resource_not_found'],
    [422, 'method_not_supported'],
  ])(
    'si Channex responde %i (%s), el reporte queda REJECTED y no se vuelve a enviar',
    async (status, code) => {
      const reservation = await aBookingReservationFromYesterday();
      await app.get<CloseDay>(CLOSE_DAY).execute(ARRIVAL);
      channexAnswersNoShow(() =>
        HttpResponse.json({ errors: { code, title: code } }, { status }),
      );

      await cycleAt(FIRST_CYCLE_AT);
      await cycleAt(SECOND_CYCLE_AT);

      expect(calls).toHaveLength(1);
      expect(await statusOf(reservation)).toBe('NO_SHOW');
      expect(await reportRows()).toEqual([
        { result: 'REJECTED', attempts: 1, reported_millis: null },
      ]);
    },
  );
});
