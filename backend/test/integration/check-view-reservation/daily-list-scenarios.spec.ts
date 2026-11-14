import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { App } from 'supertest/types.js';
import { DataSource } from 'typeorm';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { CLOCK, type Clock } from '../../../src/application/ports/out/clock.js';
import {
  OTA_REPOSITORY,
  type OtaRepository,
} from '../../../src/application/ports/out/ota.repository.js';
import {
  RESERVATION_REPOSITORY,
  type ReservationRepository,
} from '../../../src/application/ports/out/reservation.repository.js';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../src/application/ports/out/transaction.js';
import {
  DAILY_LIST_CHANGE_RECORDER,
  type DailyListChangeRecorder,
} from '../../../src/application/use-cases/check-view-reservation/ports/in/daily-list-change-recorder.port.js';
import { configureApp } from '../../../src/configure-app.js';
import type { ReservationProps } from '../../../src/domain/reservation/reservation.js';
import { DAILY_LIST_QUEUE } from '../../../src/infrastructure/config/rabbitmq.topology.js';
import { DailyListJob } from '../../../src/infrastructure/in/jobs/daily-list.job.js';
import {
  aDirectReservation,
  aDirectRoom,
  aGuest,
  anOta,
  anOtaReservation,
  otaTerms,
} from '../../support/builders.js';
import { integrationEnv, truncateAllTables } from '../support/database.js';

/** El día operativo con el que arranca la aplicación; cada prueba usa el suyo, después. */
const BOOT_DAY = '2036-02-01';

/** Lo que recibe el Módulo 1 en `m1.reservas.diarias.queue`. */
type DailyMessage = {
  messageId: string;
  sequenceNumber: number;
  operationalDate: string;
  totalReservations?: number;
  totalRooms?: number;
  totalGuests?: number;
  reservations?: Record<string, unknown>[];
  updateType?: string;
};

/**
 * T027 de `check-view-reservation`: los escenarios 1 a 4 de la historia 4 del spec (la lista del día al
 * Módulo 1) y el envío vacío, con lo que pide su fila en "Pruebas por escenario" del plan. Todo es real: la
 * aplicación completa, `DailyListJob` (el inicio del día operativo), PostgreSQL y RabbitMQ. Lo que se revisa
 * es lo que el Módulo 1 recibe en su cola (`m1.reservas.diarias.queue`), no solo lo guardado.
 */
describe('check-view-reservation: escenarios 1 a 4 de la historia 4, la lista del día al Módulo 1 (T027)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let reservations: ReservationRepository;
  let rabbit: AmqpConnection;
  let today = BOOT_DAY;
  const clock: Clock = {
    today: () => today,
    now: () => new Date(`${today}T05:00:02.000Z`),
  };

  /** `days` días después de `today`. */
  const plusDays = (days: number) => {
    const date = new Date(`${today}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  };

  /** Una reserva directa que llega hoy, con sus habitaciones de `guestCounts` personas. */
  const arrivingToday = (
    guestCounts: number[],
    changes: Partial<ReservationProps> = {},
  ) =>
    reservations.insert(
      aDirectReservation({
        startDate: today,
        endDate: plusDays(2),
        rooms: guestCounts.map((guestCount, index) =>
          aDirectRoom({ roomNumber: String(301 + index), guestCount }),
        ),
        ...changes,
      }),
    );

  /** El inicio del día operativo `day`: la tarea de las 00:00, con su bloqueo. */
  async function startDay(): Promise<void> {
    await app.get(DailyListJob).run();
  }

  /**
   * Los mensajes de la lista del día de hoy que llegaron a la cola del Módulo 1, por secuencia. Espera a que
   * se publique la cantidad de mensajes guardados para hoy (la publicación sale apenas se confirma).
   */
  async function receivedToday(expected: number): Promise<DailyMessage[]> {
    await vi.waitFor(
      async () => {
        const [{ published }]: { published: number }[] = await dataSource.query(
          `SELECT count(*)::int AS published FROM daily_list_message
           WHERE operational_date = $1 AND publish_status = 'PUBLISHED'`,
          [today],
        );
        expect(published).toBe(expected);
      },
      { timeout: 10_000, interval: 50 },
    );
    const messages: DailyMessage[] = [];
    for (;;) {
      const got = await rabbit.channel.get(DAILY_LIST_QUEUE, { noAck: true });
      if (got === false) {
        break;
      }
      messages.push(JSON.parse(got.content.toString('utf8')) as DailyMessage);
    }
    return messages
      .filter(({ operationalDate }) => operationalDate === today)
      .sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  }

  beforeAll(async () => {
    // AppConfigModule lee el entorno al importarse: AppModule se importa después de asignarlo.
    Object.assign(process.env, { NODE_ENV: 'test', ...integrationEnv() });
    const { AppModule } = await import('../../../src/app.module.js');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CLOCK)
      .useValue(clock)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    dataSource = app.get(DataSource);
    reservations = app.get<ReservationRepository>(RESERVATION_REPOSITORY);
    rabbit = app.get(AmqpConnection);
    await vi.waitFor(() => expect(() => rabbit.channel).not.toThrow(), {
      timeout: 15_000,
      interval: 100,
    });
  });

  let day = 0;
  beforeEach(async () => {
    await truncateAllTables(dataSource);
    // Cada prueba en su propio día operativo, posterior al del arranque.
    day += 1;
    today = new Date(Date.UTC(2036, 2, day)).toISOString().slice(0, 10);
    await rabbit.channel.purgeQueue(DAILY_LIST_QUEUE);
  });

  afterAll(async () => {
    if (dataSource !== undefined) {
      await truncateAllTables(dataSource);
    }
    await app?.close();
  });

  it('escenario 1: con tres reservas ACTIVE de hoy (1 hab. y 2 personas, 2 hab. y 5, 1 hab. y 1), el Módulo 1 recibe una lista con 3 reservas, 4 habitaciones y 8 personas, y el detalle de FR-014', async () => {
    const couple = await arrivingToday([2], {
      notes: 'Llegada tarde',
      guest: aGuest({
        firstName: 'Ana',
        lastName: 'Pérez',
        documentType: 'CC',
        documentNumber: '1234567',
        nationality: 'Colombia',
        contactPhone: '+57 300 000 0000',
        contactEmail: 'ana@correo.com',
      }),
    });
    await arrivingToday([2, 3]);
    await arrivingToday([1]);

    await startDay();
    const [list] = await receivedToday(1);

    expect(list).toMatchObject({
      sequenceNumber: 1,
      operationalDate: today,
      totalReservations: 3,
      totalRooms: 4,
      totalGuests: 8,
    });
    expect(list.messageId).toMatch(/^[0-9a-f-]{36}$/);
    const sent = list.reservations?.find(
      (item) => item.reservationRef === couple.reservationRef,
    );
    expect(sent).toMatchObject({
      reservationRef: couple.reservationRef,
      status: 'ACTIVE',
      source: 'DIRECTA',
      startDate: today,
      endDate: plusDays(2),
      guestCount: 2,
      notes: 'Llegada tarde',
      rooms: [
        {
          roomId: couple.rooms[0].roomId,
          roomNumber: '301',
          categoryRoom: 'DOBLE',
          guestCount: 2,
        },
      ],
      guest: {
        guestRef: couple.guest.id,
        firstName: 'Ana',
        lastName: 'Pérez',
        fullName: 'Ana Pérez',
        documentType: 'CC',
        documentNumber: '1234567',
        nationality: 'Colombia',
        contactPhone: '+57 300 000 0000',
        contactEmail: 'ana@correo.com',
      },
    });
    expect(sent?.updatedAt).toMatch(
      /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}-05:00$/,
    );
    // Nunca tarifas, comisión ni noches (FR-015).
    const text = JSON.stringify(list);
    for (const forbidden of [
      'grossAmount',
      'roomGrossAmount',
      'commission',
      'quoteId',
      'nights',
    ]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('escenario 2: solo viajan las ACTIVE con llegada hoy (también la de Booking, con su agencia y su código)', async () => {
    const agency = await app
      .get<OtaRepository>(OTA_REPOSITORY)
      .insert(anOta({ name: 'Booking.com' }));
    const active = await arrivingToday([2]);
    const booking = await reservations.insert(
      anOtaReservation(agency.id, {
        startDate: today,
        endDate: plusDays(1),
        ota: otaTerms(agency.id, { externalConfirmationCode: '9996013801' }),
      }),
    );
    await arrivingToday([2], { status: 'PENDING' });
    await arrivingToday([2], {
      status: 'CANCELLED',
      statusReason: 'CANCELLED_BY_RECEPTION',
    });
    await reservations.insert(
      aDirectReservation({ startDate: plusDays(1), endDate: plusDays(3) }),
    );

    await startDay();
    const [list] = await receivedToday(1);

    expect(
      list.reservations?.map((item) => item.reservationRef).sort(),
    ).toEqual([active.reservationRef, booking.reservationRef].sort());
    expect(
      list.reservations?.find(
        (item) => item.reservationRef === booking.reservationRef,
      ),
    ).toMatchObject({
      source: 'BOOKING',
      externalConfirmationCode: '9996013801',
    });
    expect(list.totalReservations).toBe(2);
  });

  it('escenario 3: un día sin llegadas: el Módulo 1 recibe la lista con cero reservas y los totales en 0', async () => {
    await reservations.insert(
      aDirectReservation({ startDate: plusDays(1), endDate: plusDays(3) }),
    );

    await startDay();
    const messages = await receivedToday(1);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      sequenceNumber: 1,
      totalReservations: 0,
      totalRooms: 0,
      totalGuests: 0,
      reservations: [],
    });
  });

  it('escenario 4: si el inicio del día corre de nuevo el mismo día, no se envía otra lista; un cambio posterior viaja como actualización', async () => {
    await arrivingToday([2]);
    await startDay();
    await receivedToday(1);

    // Un reinicio del servidor: la tarea corre otra vez el mismo día.
    await startDay();
    const late = await arrivingToday([1]);
    await app
      .get<TransactionRunner>(TRANSACTION_RUNNER)
      .run((tx) =>
        app
          .get<DailyListChangeRecorder>(DAILY_LIST_CHANGE_RECORDER)
          .record(tx, null, late),
      );
    const messages = await receivedToday(2);

    expect(messages.map(({ sequenceNumber }) => sequenceNumber)).toEqual([2]);
    expect(messages[0].updateType).toBe('ADDED');
    const [{ lists }]: { lists: number }[] = await dataSource.query(
      `SELECT count(*)::int AS lists FROM daily_list_message
       WHERE operational_date = $1 AND message_kind = 'LIST'`,
      [today],
    );
    expect(lists).toBe(1);
  });
});
