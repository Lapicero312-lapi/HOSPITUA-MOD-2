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
import { CLOCK, type Clock } from '../../../src/application/ports/out/clock.js';
import type { BookingFeedRead } from '../../../src/application/use-cases/generate-ota-reservation/ports/in/read-booking-feed.port.js';
import { ReadBookingFeedService } from '../../../src/application/use-cases/generate-ota-reservation/read-booking-feed.service.js';
import { configureApp } from '../../../src/configure-app.js';
import { ChannexSetupJob } from '../../../src/infrastructure/in/jobs/channex-setup.job.js';
import { ChannexSyncJob } from '../../../src/infrastructure/in/jobs/channex-sync.job.js';
import { TypeOrmReservationRepository } from '../../../src/infrastructure/out/persistence/repositories/reservation.repository.js';
import { anOtaReservation, otaTerms } from '../../support/builders.js';
import {
  integrationEnv,
  openTestDataSource,
  truncateAllTables,
} from '../support/database.js';

/**
 * Pruebas de la historia 3 de `register-ota-information-commission` (T018): los escenarios 1 a 5 de la spec
 * y los casos borde de la tarea (nace `CONNECTED` y sin porcentaje, rechazo de Channex y recuperación). Con
 * la aplicación completa, PostgreSQL real y Channex simulado en HTTP (msw): el registro sale del arranque
 * (`ChannexSetupJob`), el reinicio es volver a arrancar y cada lectura del feed pasa por `ChannexSyncJob` y
 * el adaptador real. Solo el reloj es fijo, para saber la hora de cada paso.
 */

/** Channex simulado. La clave es de prueba: nunca se llama al Channex real. */
const CHANNEX_BASE_URL = 'http://channex.test';
const PROPERTY_ID = '716305c4-561a-4561-a187-7f5b8aeb5920';

/** Las horas de cada paso: el arranque, dos lecturas del feed y el reinicio del día siguiente. */
const STARTED_AT = new Date('2026-11-09T13:00:00.000Z');
const FIRST_READ_AT = new Date('2026-11-09T13:30:00.000Z');
const SECOND_READ_AT = new Date('2026-11-09T14:00:00.000Z');
const RESTARTED_AT = new Date('2026-11-10T13:00:00.000Z');

/** Una revisión del feed que el adaptador puede leer (ejemplo A1 de `generate-ota-reservation`). */
const A_REVISION = {
  type: 'booking_revision',
  id: 'f0b3a1d2-6c4e-4a8b-9d1f-2e3c4b5a6d7e',
  attributes: {
    id: 'f0b3a1d2-6c4e-4a8b-9d1f-2e3c4b5a6d7e',
    booking_id: '8a7b6c5d-4e3f-4a2b-9c1d-0e9f8a7b6c5d',
    ota_reservation_code: '9996013801',
    ota_name: 'Booking.com',
    status: 'new',
    arrival_date: '2026-11-20',
    departure_date: '2026-11-22',
    amount: '220.00',
    ota_commission: '33.00',
    currency: 'USD',
    customer: { name: 'Ana', surname: 'Pérez', country: 'CO' },
    rooms: [
      {
        room_type_id: '3c2b1a09-8f7e-4d6c-b5a4-938271605f4e',
        rate_plan_id: '445835fb-7956-42ac-9efc-3e6f331f0808',
        checkin_date: '2026-11-20',
        checkout_date: '2026-11-22',
        occupancy: { adults: 2, children: 0, infants: 0 },
      },
    ],
  },
};

type Agency = {
  id: string;
  name: string;
  commission_percentage: string | null;
  connection_status: string;
  linked_at: Date;
  last_sync_at: Date;
};

const server = setupServer();

describe('Registro de la agencia y estado de la conexión (register-ota-information-commission, historia 3)', () => {
  let dataSource: DataSource;
  let app: INestApplication | undefined;
  let now: Date;
  const clock: Clock = { now: () => now, today: () => '2026-11-09' };

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    // Antes de importar AppModule: AppConfigModule lee el entorno al importarse. El intervalo largo evita
    // que la tarea lea el feed por su cuenta durante la prueba; cada lectura la dispara la prueba.
    Object.assign(process.env, {
      NODE_ENV: 'test',
      ...integrationEnv(),
      CHANNEX_BASE_URL,
      CHANNEX_API_KEY: 'clave-de-prueba',
      CHANNEX_PROPERTY_ID: PROPERTY_ID,
      CHANNEX_SYNC_INTERVAL_SECONDS: '3600',
    });
    // Lo que no va a Channex (la base, por ejemplo) pasa sin tocarse. Una llamada a Channex sin respuesta
    // simulada es un error de la prueba.
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
    now = STARTED_AT;
    // A0 de `configure-ota`: la propiedad configurada está en la cuenta, así que el arranque queda listo.
    server.use(
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
    );
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
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

  /** Arranca el sistema y espera a que termine la configuración de Channex del arranque. */
  async function startSystem(): Promise<void> {
    const attempt = vi.spyOn(ChannexSetupJob.prototype, 'attempt');
    const { AppModule } = await import('../../../src/app.module.js');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CLOCK)
      .useValue(clock)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    expect(attempt).toHaveBeenCalledTimes(1);
    await expect(attempt.mock.results[0].value).resolves.toBe('READY');
    attempt.mockRestore();
  }

  /** Apaga el sistema y lo vuelve a arrancar a la hora `at`. */
  async function restartSystem(at: Date): Promise<void> {
    await app?.close();
    now = at;
    await startSystem();
  }

  /** Channex responde el feed con `revisions` o con el estado de error `status`. */
  function channexFeedAnswers(answer: unknown[] | 401 | 403): void {
    server.use(
      http.get(`${CHANNEX_BASE_URL}/api/v1/booking_revisions/feed`, () =>
        Array.isArray(answer)
          ? HttpResponse.json({
              meta: { total: answer.length, page: 1, limit: 100 },
              data: answer,
            })
          : HttpResponse.json(
              { errors: { code: 'unauthorized', title: 'Unauthorized' } },
              { status: answer },
            ),
      ),
    );
  }

  /** Una lectura del feed a la hora `at`, como la dispara la tarea programada. */
  async function readFeedAt(at: Date): Promise<void> {
    now = at;
    await expect(app!.get(ChannexSyncJob).run()).resolves.toBe(true);
  }

  /** Las agencias guardadas; las fechas llegan como texto y se comparan como fechas. */
  async function agencies(): Promise<Agency[]> {
    const rows: (Omit<Agency, 'linked_at' | 'last_sync_at'> & {
      linked_at: string;
      last_sync_at: string;
    })[] = await dataSource.query(
      `SELECT id, name, commission_percentage, connection_status, linked_at, last_sync_at
         FROM ota ORDER BY name`,
    );
    return rows.map((row) => ({
      ...row,
      linked_at: new Date(row.linked_at),
      last_sync_at: new Date(row.last_sync_at),
    }));
  }

  /** La única agencia registrada. */
  async function theAgency(): Promise<Agency> {
    const all = await agencies();
    expect(all).toHaveLength(1);
    return all[0];
  }

  /** Lo que la spec dice que conserva cada reserva de la agencia: su estado y su comisión. */
  async function reservationsOf(otaId: string): Promise<unknown[]> {
    return dataSource.query(
      `SELECT reservation_ref, status, commission_amount, commission_status
         FROM reservation WHERE ota_id = $1 ORDER BY reservation_ref`,
      [otaId],
    );
  }

  it('escenario 1: al iniciar, sin la agencia, registra Booking.com en CONNECTED, con su linkedAt y sin porcentaje', async () => {
    await startSystem();

    expect(await agencies()).toEqual([
      {
        id: expect.any(String),
        name: 'Booking.com',
        commission_percentage: null,
        connection_status: 'CONNECTED',
        linked_at: STARTED_AT,
        // Plan, B2: nace con linkedAt y lastSyncAt iguales a la hora del registro.
        last_sync_at: STARTED_AT,
      },
    ]);
  });

  it.each([
    ['con porcentaje', '15.00'],
    ['sin porcentaje', null],
  ])(
    'escenario 2: al reiniciar, con la agencia ya registrada %s, no crea otra y conserva su porcentaje',
    async (_, percentage) => {
      await startSystem();
      await dataSource.query('UPDATE ota SET commission_percentage = $1', [
        percentage,
      ]);
      const before = await theAgency();

      await restartSystem(RESTARTED_AT);

      // La misma agencia, sin cambios: ni el porcentaje, ni el linkedAt, ni el estado ni la última lectura.
      expect(await theAgency()).toEqual(before);
      expect(before.commission_percentage).toBe(percentage);
    },
  );

  it.each([
    ['401 (clave de acceso inválida)', 401 as const],
    ['403 (sin permiso)', 403 as const],
  ])(
    'escenario 3: si Channex rechaza la lectura del feed con %s, la agencia pasa a DISCONNECTED y ella y sus reservas se conservan',
    async (_, status) => {
      await startSystem();
      // Con reservas, la agencia ya tiene el porcentaje que se calculó con la primera.
      await dataSource.query("UPDATE ota SET commission_percentage = '15.00'");
      const before = await theAgency();
      expect(before.commission_percentage).toBe('15.00');
      const reservations = new TypeOrmReservationRepository(dataSource);
      await reservations.insert(
        anOtaReservation(before.id, { status: 'ACTIVE' }),
      );
      await reservations.insert(
        anOtaReservation(before.id, {
          status: 'COMPLETED',
          ota: otaTerms(before.id, {
            externalConfirmationCode: '4417829014',
            commissionStatus: 'RECONCILED',
          }),
        }),
      );
      const reservationsBefore = await reservationsOf(before.id);
      channexFeedAnswers(status);

      await readFeedAt(FIRST_READ_AT);

      // Plan, B3: el rechazo no cambia lastSyncAt, que es la última lectura que terminó bien.
      expect(await theAgency()).toEqual({
        ...before,
        connection_status: 'DISCONNECTED',
      });
      expect(await reservationsOf(before.id)).toEqual(reservationsBefore);
      expect(reservationsBefore).toHaveLength(2);
    },
  );

  it('escenario 4: después de un rechazo, cuando una lectura del feed vuelve a funcionar, vuelve a CONNECTED sin perder su linkedAt', async () => {
    await startSystem();
    channexFeedAnswers(401);
    await readFeedAt(FIRST_READ_AT);
    expect((await theAgency()).connection_status).toBe('DISCONNECTED');

    channexFeedAnswers([]);
    await readFeedAt(SECOND_READ_AT);

    expect(await agencies()).toEqual([
      expect.objectContaining({
        name: 'Booking.com',
        connection_status: 'CONNECTED',
        linked_at: STARTED_AT,
        last_sync_at: SECOND_READ_AT,
      }),
    ]);
  });

  it.each([
    ['sin reservas', []],
    ['con una reserva', [A_REVISION]],
  ])(
    'escenario 5: una lectura del feed que termina bien %s actualiza lastSyncAt con la hora de esa lectura',
    async (_, revisions) => {
      await startSystem();
      const before = await theAgency();
      const read = vi.spyOn(ReadBookingFeedService.prototype, 'read');
      channexFeedAnswers(revisions);

      await readFeedAt(FIRST_READ_AT);

      // La lectura terminó bien y trajo lo que respondió Channex.
      const result = (await read.mock.results[0].value) as BookingFeedRead;
      expect(result.status).toBe('READ');
      expect(result.status === 'READ' && result.revisions).toHaveLength(
        revisions.length,
      );
      expect(await theAgency()).toEqual({
        ...before,
        last_sync_at: FIRST_READ_AT,
      });
    },
  );
});
