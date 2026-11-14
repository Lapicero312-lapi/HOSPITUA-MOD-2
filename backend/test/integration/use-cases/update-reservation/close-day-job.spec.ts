import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Settings } from 'luxon';
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
  RESERVATION_QUERY_PORT,
  type ReservationQueryPort,
} from '../../../../src/application/ports/out/reservation-query.port.js';
import { CLOSE_DAY_BATCH_SIZE } from '../../../../src/application/use-cases/update-reservation/ports/in/close-day.port.js';
import type {
  Reservation,
  ReservationProps,
} from '../../../../src/domain/reservation/reservation.js';
import { CloseDayJob } from '../../../../src/infrastructure/in/jobs/close-day.job.js';
import { TypeOrmOtaBookingRevisionRepository } from '../../../../src/infrastructure/out/persistence/repositories/ota-booking-revision.repository.js';
import { TypeOrmOtaRepository } from '../../../../src/infrastructure/out/persistence/repositories/ota.repository.js';
import { TypeOrmReservationRepository } from '../../../../src/infrastructure/out/persistence/repositories/reservation.repository.js';
import { TypeOrmTransactionRunner } from '../../../../src/infrastructure/out/persistence/typeorm-transaction.js';
import {
  aDirectReservation,
  aDirectRoom,
  anOta,
  anOtaReservation,
} from '../../../support/builders.js';
import {
  integrationEnv,
  openTestDataSource,
  truncateAllTables,
} from '../../support/database.js';

/**
 * El día que se cierra y los de alrededor. La aplicación arranca a las 23:59 del día (la recuperación no lo
 * cierra: todavía no termina) y el cierre corre a las 00:00:30 del día siguiente (FR-018).
 */
const DAY = '2026-10-09';
const NEXT = '2026-10-10';
const OLDER = '2026-10-06';
const BEFORE = '2026-10-08';
const LAST_MINUTE = new Date('2026-10-10T04:59:00.000Z');
const CLOSING_AT = new Date('2026-10-10T05:00:30.000Z');

/** El `booking_id` de Channex de la reserva de Booking (ejemplo A1 del plan de generate-ota-reservation). */
const BOOKING_ID = 'cfa33f3b-bd32-4b90-8ef9-bde2bfe986cd';

/** La alerta por la pérdida de la base de datos (punto 14): sin el texto del error. */
const DATABASE_ALERT =
  'El cierre del día se detuvo antes de terminar porque la base de datos no respondió: ninguna reserva quedó a medias y la próxima ejecución completa lo que faltó.';

type ReservationRow = { status: string; status_reason: string | null };
type RoomRow = { stay_status: string; blocks_inventory: boolean };

/**
 * T024 de `update-reservation`: los escenarios 1, 3, 4 y 5 de la historia 3, la idempotencia y los casos
 * borde del cierre (la pérdida de la base de datos y la zona horaria), con `CloseDayJob` (T022) en la
 * aplicación completa (`AppModule`) y PostgreSQL real. Las reglas de cada reserva las prueban `CloseDay` y
 * sus pruebas de integración (T021); aquí, que la tarea las dispara cuando y como dice el plan (punto 14).
 */
describe('CloseDayJob con la aplicación completa y PostgreSQL real (T022 y T024)', () => {
  let dataSource: DataSource;
  let reservations: TypeOrmReservationRepository;
  let app: INestApplication | null;
  let now: Date;
  let errors: string[];
  let warnings: string[];
  const clock: Clock = {
    now: () => now,
    today: () =>
      new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(
        now,
      ),
  };

  /**
   * Arranca la aplicación a la hora `at`: la recuperación del cierre corre en el arranque. Con
   * `realClock`, el `Clock` es el del hotel (`HotelClock`), que la prueba fija con `Settings.now` de luxon.
   */
  async function startAt(
    at: Date,
    { batchSize = 100, realClock = false } = {},
  ): Promise<INestApplication> {
    now = at;
    const { AppModule } = await import('../../../../src/app.module.js');
    let builder = Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CLOSE_DAY_BATCH_SIZE)
      .useValue(batchSize);
    if (!realClock) {
      builder = builder.overrideProvider(CLOCK).useValue(clock);
    }
    const moduleRef = await builder.compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    return app;
  }

  /** Una reserva directa guardada que llega `startDate`. */
  const directArriving = (
    startDate: string,
    changes: Partial<ReservationProps> = {},
  ) =>
    reservations.insert(
      aDirectReservation({ startDate, endDate: '2026-10-12', ...changes }),
    );

  /** Una reserva de Booking guardada que llega el día, con la revisión que la creó si `withRevision`. */
  const fromBooking = async (
    withRevision: boolean,
    changes: Partial<ReservationProps> = {},
  ): Promise<Reservation> => {
    const ota = await new TypeOrmOtaRepository(dataSource).insert(
      anOta({ name: `Booking.com ${randomUUID()}` }),
    );
    const saved = await reservations.insert(
      anOtaReservation(ota.id, {
        startDate: DAY,
        endDate: '2026-10-12',
        ...changes,
      }),
    );
    if (withRevision) {
      await new TypeOrmTransactionRunner(dataSource).run((tx) =>
        new TypeOrmOtaBookingRevisionRepository(dataSource).record(
          {
            revisionId: randomUUID(),
            otaId: ota.id,
            bookingId: BOOKING_ID,
            status: 'new',
            reservationId: saved.id,
            result: 'APPLIED',
          },
          tx,
        ),
      );
    }
    return saved;
  };

  const reservationRow = async (
    saved: Reservation,
  ): Promise<ReservationRow> => {
    const [row]: ReservationRow[] = await dataSource.query(
      'SELECT status, status_reason FROM reservation WHERE id = $1',
      [saved.id],
    );
    return row;
  };
  const statusOf = async (saved: Reservation) =>
    (await reservationRow(saved)).status;
  const roomRows = (saved: Reservation): Promise<RoomRow[]> =>
    dataSource.query(
      `SELECT stay_status, blocks_inventory FROM reservation_room
       WHERE reservation_id = $1 ORDER BY room_number, id`,
      [saved.id],
    );
  const removedMessages = (): Promise<
    { operational_date: string; removal_reason: string; ref: string }[]
  > =>
    dataSource.query(
      `SELECT operational_date::text, removal_reason, payload->>'reservationRef' AS ref
       FROM daily_list_message WHERE update_type = 'REMOVED'
       ORDER BY operational_date, sequence_number`,
    );
  const count = async (table: string): Promise<number> => {
    const [{ total }]: { total: number }[] = await dataSource.query(
      `SELECT count(*)::int AS total FROM ${table}`,
    );
    return total;
  };

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    reservations = new TypeOrmReservationRepository(dataSource);
    // Antes de importar AppModule: AppConfigModule lee el entorno al importarse.
    Object.assign(process.env, { NODE_ENV: 'test', ...integrationEnv() });
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    app = null;
    errors = [];
    warnings = [];
    vi.spyOn(Logger.prototype, 'error').mockImplementation(
      (message: unknown) => {
        errors.push(String(message));
      },
    );
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(
      (message: unknown) => {
        warnings.push(String(message));
      },
    );
    // La máquina de las pruebas, en la zona del hotel, salvo en la prueba de la zona horaria.
    vi.stubEnv('TZ', 'America/Bogota');
  });

  afterEach(async () => {
    await app?.close();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    Settings.now = () => Date.now();
  });

  afterAll(async () => {
    await truncateAllTables(dataSource);
    await dataSource.destroy();
  });

  /** Solo las alertas del cierre: el arranque deja otros errores (Channex sin configurar). */
  const closeDayAlerts = () =>
    errors.filter(
      (message) =>
        message.startsWith('El cierre del día') ||
        message.startsWith('Alerta: la zona horaria'),
    );

  describe('a las 00:00:30 cierra el día que terminó, y no el de hoy', () => {
    it('escenarios 1, 3, 4 y 5 en una sola ejecución, con el REMOVED en la lista del día cerrado', async () => {
      // Escenario 1: una directa ACTIVE y una de Booking PENDING, sin ingreso.
      const direct = await directArriving(DAY);
      const booking = await fromBooking(true, { status: 'PENDING' });
      // Escenario 3: llegó parte del grupo.
      const partial = await directArriving(DAY, {
        status: 'IN_PROGRESS',
        rooms: [
          aDirectRoom({ stayStatus: 'CHECKED_IN' }),
          aDirectRoom({ roomNumber: '202' }),
        ],
      });
      // Escenario 4: todo el grupo ingresó.
      const allIn = await directArriving(DAY, {
        status: 'IN_PROGRESS',
        rooms: [aDirectRoom({ stayStatus: 'CHECKED_IN' })],
      });
      // Escenario 5: una de Booking sin la revisión que la creó, así que su reporte no se puede dejar.
      const corrupt = await fromBooking(false);
      // La que llega mañana.
      const tomorrow = await directArriving(NEXT);

      const running = await startAt(LAST_MINUTE);
      // A las 23:59 el día no ha terminado: la recuperación al arrancar no lo cierra.
      expect(await statusOf(direct)).toBe('ACTIVE');
      expect(await statusOf(booking)).toBe('PENDING');

      now = CLOSING_AT;
      await running.get(CloseDayJob).onSchedule();

      expect(await reservationRow(direct)).toEqual({
        status: 'NO_SHOW',
        status_reason: 'DAY_CLOSE_NO_SHOW',
      });
      expect(await roomRows(direct)).toEqual([
        { stay_status: 'NOT_ARRIVED', blocks_inventory: false },
      ]);
      expect(await statusOf(booking)).toBe('NO_SHOW');
      expect(
        await dataSource.query(
          'SELECT reservation_id::text, result FROM ota_no_show_report',
        ),
      ).toEqual([{ reservation_id: booking.id, result: 'PENDING' }]);
      expect(await statusOf(partial)).toBe('IN_PROGRESS');
      expect(await roomRows(partial)).toEqual([
        { stay_status: 'CHECKED_IN', blocks_inventory: true },
        { stay_status: 'NOT_ARRIVED', blocks_inventory: false },
      ]);
      expect(await statusOf(allIn)).toBe('IN_PROGRESS');
      expect(await roomRows(allIn)).toEqual([
        { stay_status: 'CHECKED_IN', blocks_inventory: true },
      ]);
      // El fallo aislado: queda intacta, con su advertencia, y no detuvo a las demás.
      expect(await reservationRow(corrupt)).toEqual({
        status: 'ACTIVE',
        status_reason: null,
      });
      expect(await roomRows(corrupt)).toEqual([
        { stay_status: 'EXPECTED', blocks_inventory: true },
      ]);
      expect(warnings).toEqual([
        expect.stringContaining(
          `La reserva ${corrupt.reservationRef} no se pudo cerrar el día ${DAY}`,
        ) as string,
      ]);
      expect(await statusOf(tomorrow)).toBe('ACTIVE');
      // Sin Cancellation (FR-021) y el REMOVED en la lista del día cerrado, no en la de hoy (T023).
      expect(await count('cancellation')).toBe(0);
      expect(await removedMessages()).toEqual([
        {
          operational_date: DAY,
          removal_reason: 'NO_SHOW',
          ref: direct.reservationRef,
        },
      ]);
      expect(closeDayAlerts()).toEqual([]);
    });

    it('idempotente (NFR-003): una segunda ejecución no cambia nada ni avisa otra vez', async () => {
      const direct = await directArriving(DAY);
      const booking = await fromBooking(true);
      const running = await startAt(LAST_MINUTE);
      now = CLOSING_AT;
      const job = running.get(CloseDayJob);
      await job.onSchedule();
      const snapshot = async () => ({
        reservations: await dataSource.query(
          'SELECT id, status, status_reason, updated_at::text FROM reservation ORDER BY id',
        ),
        rooms: await dataSource.query(
          'SELECT id, stay_status, blocks_inventory FROM reservation_room ORDER BY id',
        ),
        // Los del día cerrado: al reiniciar, DailyListJob genera la lista del día nuevo, que no es del cierre.
        messages: await dataSource.query(
          `SELECT message_id FROM daily_list_message
           WHERE operational_date = $1 ORDER BY message_id`,
          [DAY],
        ),
        reports: await dataSource.query(
          'SELECT reservation_id, result FROM ota_no_show_report',
        ),
      });
      const afterFirst = await snapshot();

      await job.onSchedule();
      // Y otra vez al arrancar, como la recuperación de un reinicio.
      await running.close();
      app = null;
      await startAt(CLOSING_AT);

      expect(await snapshot()).toEqual(afterFirst);
      expect(await statusOf(direct)).toBe('NO_SHOW');
      expect(await statusOf(booking)).toBe('NO_SHOW');
      expect(warnings).toEqual([]);
    });
  });

  describe('la recuperación al arrancar', () => {
    it('cierra cada día pendiente, del más antiguo al más reciente, aunque el servidor haya estado apagado varios días, y no el de hoy', async () => {
      const older = await directArriving(OLDER);
      const before = await directArriving(BEFORE);
      const day = await directArriving(DAY);
      const today = await directArriving(NEXT);
      const infos: string[] = [];
      vi.spyOn(Logger.prototype, 'log').mockImplementation(
        (message: unknown) => {
          infos.push(String(message));
        },
      );

      // A las 7:00 del día siguiente al último cerrado: el servidor no corrió a las 00:00:30.
      await startAt(new Date('2026-10-10T12:00:00.000Z'));

      expect(await statusOf(older)).toBe('NO_SHOW');
      expect(await statusOf(before)).toBe('NO_SHOW');
      expect(await statusOf(day)).toBe('NO_SHOW');
      expect(await statusOf(today)).toBe('ACTIVE');
      expect(
        infos.filter((message) => message.startsWith('Cierre del día')),
      ).toEqual([
        `Cierre del día ${OLDER}: 1 No-Show, 0 con habitaciones sin llegar, 0 completadas, 0 ignoradas y 0 con error.`,
        `Cierre del día ${BEFORE}: 1 No-Show, 0 con habitaciones sin llegar, 0 completadas, 0 ignoradas y 0 con error.`,
        `Cierre del día ${DAY}: 1 No-Show, 0 con habitaciones sin llegar, 0 completadas, 0 ignoradas y 0 con error.`,
      ]);
    });

    it('si otra instancia tiene el bloqueo close-day, se salta la ejecución sin cambiar nada', async () => {
      const day = await directArriving(DAY);
      const other = await dataSource.createQueryRunner();
      await other.connect();
      try {
        await other.query("SELECT pg_advisory_lock(hashtext('close-day'))");

        const running = await startAt(CLOSING_AT);
        expect(await statusOf(day)).toBe('ACTIVE');
        await expect(running.get(CloseDayJob).run()).resolves.toBe(false);
        expect(await statusOf(day)).toBe('ACTIVE');

        await other.query("SELECT pg_advisory_unlock(hashtext('close-day'))");
        await expect(running.get(CloseDayJob).run()).resolves.toBe(true);
        expect(await statusOf(day)).toBe('NO_SHOW');
      } finally {
        await other.release();
      }
    });
  });

  describe('casos borde', () => {
    it('la base de datos se pierde a mitad del lote: se detiene con la alerta, sin reservas a medias, y la siguiente ejecución lo completa', async () => {
      const arriving = [
        await directArriving(DAY),
        await directArriving(DAY),
        await directArriving(DAY),
      ];
      const running = await startAt(LAST_MINUTE, { batchSize: 2 });
      const query = running.get<ReservationQueryPort>(RESERVATION_QUERY_PORT);
      const select = query.findToClose.bind(query);
      // El primer lote sale; al pedir el segundo, la conexión ya no está.
      vi.spyOn(query, 'findToClose')
        .mockImplementationOnce(select)
        .mockRejectedValueOnce(
          new Error(
            'Connection terminated unexpectedly (host 10.0.0.5, puerto 5432)',
          ),
        );
      now = CLOSING_AT;

      await expect(running.get(CloseDayJob).run()).resolves.toBe(false);

      expect(closeDayAlerts()).toEqual([DATABASE_ALERT]);
      expect(errors.join('\n')).not.toMatch(/Connection terminated|5432/);
      const ordered = [...arriving].sort((a, b) =>
        a.reservationRef.localeCompare(b.reservationRef),
      );
      // Las dos del primer lote, completas; la tercera, intacta: ninguna a medias.
      for (const closed of ordered.slice(0, 2)) {
        expect(await statusOf(closed)).toBe('NO_SHOW');
        expect(await roomRows(closed)).toEqual([
          { stay_status: 'NOT_ARRIVED', blocks_inventory: false },
        ]);
      }
      expect(await statusOf(ordered[2])).toBe('ACTIVE');
      expect(await roomRows(ordered[2])).toEqual([
        { stay_status: 'EXPECTED', blocks_inventory: true },
      ]);

      await expect(running.get(CloseDayJob).run()).resolves.toBe(true);
      expect(await statusOf(ordered[2])).toBe('NO_SHOW');
    });

    it('con el servidor en UTC deja la alerta de negocio y cierra con el día de Colombia (las 22:00 del 9, ya el 10 en UTC)', async () => {
      vi.stubEnv('TZ', 'UTC');
      // El reloj real del hotel (`HotelClock`), a las 22:00 del 9 de octubre en Colombia.
      Settings.now = () => Date.parse('2026-10-10T03:00:00.000Z');
      const before = await directArriving(BEFORE);
      const day = await directArriving(DAY);

      await startAt(new Date('2026-10-10T03:00:00.000Z'), { realClock: true });

      expect(closeDayAlerts()).toEqual([
        'Alerta: la zona horaria del servidor (UTC, UTC+00:00) no es la del hotel (America/Bogota, UTC-05:00). El cierre del día usa la del hotel.',
      ]);
      // El 8 ya terminó en Colombia; el 9 todavía no, aunque en UTC ya sea el 10.
      expect(await statusOf(before)).toBe('NO_SHOW');
      expect(await statusOf(day)).toBe('ACTIVE');
    });
  });
});
