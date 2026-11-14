import { randomUUID } from 'node:crypto';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import type { INestApplication } from '@nestjs/common';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import request from 'supertest';
import type { App } from 'supertest/types.js';
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
import type { Clock } from '../../../../src/application/ports/out/clock.js';
import {
  EVENTS_EXCHANGE,
  INBOUND_QUEUES,
} from '../../../../src/infrastructure/config/rabbitmq.topology.js';
import { ChannexSyncJob } from '../../../../src/infrastructure/in/jobs/channex-sync.job.js';
import {
  aSimulatedChannex,
  CHANNEX_BASE_URL,
  DOBLE_TYPE,
  MODULE1_BASE_URL,
  PROPERTY_ID,
  ROOM_201,
  type SimulatedChannex,
  simulate,
  startBookingFeedApp,
  useBookingFeedEnv,
} from '../../support/booking-feed-app.js';
import {
  openTestDataSource,
  truncateAllTables,
} from '../../support/database.js';
import {
  aBody,
  createDirect,
  LODGING,
} from '../../support/direct-reservation-app.js';

/** El Módulo 3 simulado: la cotización de las reservas directas. */
const MODULE3_BASE_URL = 'http://module3.test';

/** Lo que recibe Channex en un A4. */
type SentValue = {
  property_id: string;
  room_type_id: string;
  date_from: string;
  date_to: string;
  availability: number;
};

/**
 * T012 de `configure-ota`: los escenarios 1 a 6 de la historia 3 (la disponibilidad en Channex), de punta a
 * punta: los cambios entran por donde entran en producción (la reserva directa y su cancelación por HTTP,
 * el aviso de mantenimiento E1 por RabbitMQ) y cada ciclo es una ejecución de `ChannexSyncJob`, como la del
 * intervalo de 30 s. La aplicación completa, con PostgreSQL y RabbitMQ reales, y el Módulo 1, el Módulo 3 y
 * Channex simulados en HTTP (msw). `DOBLE` tiene 3 habitaciones vendibles (la 201, la 202 y la 203), como
 * en el *Independent Test* del spec, y su tipo en Channex tiene 3.
 */
describe('configure-ota: la disponibilidad en Channex (T012, historia 3)', () => {
  const server = setupServer();
  let dataSource: DataSource;
  let app: INestApplication<App>;
  let channex: SimulatedChannex;
  /** Cada A4 que recibió Channex, con sus valores; y con qué responde el siguiente. */
  let availabilityCalls: SentValue[][];
  let availabilityStatus: number;
  /** Los mantenimientos del Módulo 1 por habitación: `[inicio, fin]`, los dos incluidos. */
  let maintenances: Record<string, [string, string][]>;
  const clock: Clock = {
    now: () => new Date('2026-11-09T15:00:00.000Z'),
    today: () => '2026-11-09',
  };

  /** Un ciclo de la tarea de Channex: el feed y después la disponibilidad pendiente. */
  const cycle = async () => {
    await expect(app.get(ChannexSyncJob).run()).resolves.toBe(true);
  };

  /** Una reserva directa de la Recepcionista, de una habitación de `DOBLE`. */
  const reserve = async (
    startDate: string,
    endDate: string,
    roomId?: string,
  ): Promise<string> => {
    const { body } = await createDirect(
      app,
      aBody(startDate, endDate, [{ guestCount: 2, roomId }]),
    ).expect(201);
    return body.reservationRef as string;
  };

  /** La cancelación de la Recepcionista, con el `updatedAt` del detalle. */
  const cancel = async (reservationRef: string) => {
    const { body } = await request(app.getHttpServer())
      .get(`/api/reservations/${reservationRef}`)
      .set('X-Client', 'RECEPTIONIST')
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/reservations/${reservationRef}/cancellation`)
      .set('X-User', 'Laura Méndez')
      .send({ updatedAt: body.updatedAt as string, acknowledged: true })
      .expect(200);
  };

  const pendingMarks = async () => {
    const [{ total }]: { total: number }[] = await dataSource.query(
      'SELECT count(*)::int AS total FROM ari_pending_change',
    );
    return total;
  };

  /**
   * El Módulo 1 registra un mantenimiento de la habitación y lo avisa por la cola (E1, `SCHEDULED`); la
   * prueba espera a que el aviso deje sus marcas.
   */
  const scheduleMaintenance = async (
    roomId: string,
    startDate: string,
    endDate: string,
  ) => {
    maintenances[roomId] = [
      ...(maintenances[roomId] ?? []),
      [startDate, endDate],
    ];
    const marksBefore = await pendingMarks();
    await app.get(AmqpConnection).publish(
      EVENTS_EXCHANGE,
      INBOUND_QUEUES.MAINTENANCE.routingKey,
      {
        messageId: randomUUID(),
        sequenceNumber: 1,
        maintenanceId: randomUUID(),
        action: 'SCHEDULED',
        roomId,
        categoryRoom: 'DOBLE',
        startDate,
        endDate,
      },
      { persistent: true },
    );
    await vi.waitFor(
      async () => expect(await pendingMarks()).toBeGreaterThan(marksBefore),
      { timeout: 15_000, interval: 100 },
    );
  };

  /** Una noche o un tramo de `DOBLE` con su disponibilidad, como llega a Channex. */
  const doble = (
    dateFrom: string,
    dateTo: string,
    availability: number,
  ): SentValue => ({
    property_id: PROPERTY_ID,
    room_type_id: DOBLE_TYPE,
    date_from: dateFrom,
    date_to: dateTo,
    availability,
  });

  const statuses = async (): Promise<string[]> =>
    (
      await dataSource.query<{ status: string }[]>(
        'SELECT status FROM reservation ORDER BY created_at',
      )
    ).map(({ status }) => status);

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    useBookingFeedEnv();
    process.env.MODULE3_BASE_URL = MODULE3_BASE_URL;
    server.listen({ onUnhandledRequest: 'bypass' });
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    await dataSource.query(
      `INSERT INTO ota_room_type_mapping (channex_room_type_id, category_room, count_of_rooms, occupancy)
       VALUES ($1, 'DOBLE', 3, 2)`,
      [DOBLE_TYPE],
    );
    channex = aSimulatedChannex();
    availabilityCalls = [];
    availabilityStatus = 200;
    maintenances = {};
    simulate(server, channex);
    server.use(
      http.post(
        `${CHANNEX_BASE_URL}/api/v1/availability`,
        async ({ request: sent }) => {
          const body = (await sent.json()) as { values: SentValue[] };
          availabilityCalls.push(body.values);
          return availabilityStatus === 200
            ? HttpResponse.json({ data: [], meta: { message: 'Success' } })
            : HttpResponse.json({}, { status: availabilityStatus });
        },
      ),
      // Como el Módulo 1: los mantenimientos de la habitación que se cruzan con [startDate, endDate).
      http.get(
        `${MODULE1_BASE_URL}/api/rooms/:roomId/maintenances`,
        ({ params, request: asked }) => {
          const query = new URL(asked.url).searchParams;
          const startDate = query.get('startDate') ?? '';
          const endDate = query.get('endDate') ?? '';
          const roomId = String(params.roomId);
          const conflicts = (maintenances[roomId] ?? [])
            .filter(([start, end]) => start < endDate && end >= startDate)
            .map(([maintenanceStart, maintenanceEnd]) => ({
              maintenanceStart,
              maintenanceEnd,
            }));
          return HttpResponse.json({
            roomId,
            available: conflicts.length === 0,
            conflicts,
          });
        },
      ),
      http.post(`${MODULE3_BASE_URL}/pricing/quotes`, () =>
        HttpResponse.json({
          quoteId: randomUUID(),
          currency: 'COP',
          nightlyRates: [],
          lodgingAmount: LODGING,
        }),
      ),
    );
    app = await startBookingFeedApp(clock);
  });

  afterEach(async () => {
    await app.close();
    server.resetHandlers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    server.close();
    await truncateAllTables(dataSource);
    await dataSource.destroy();
  });

  it('escenario 1: una reserva de una habitación del 10 al 12 baja la disponibilidad a 2 el 10 y el 11 (la noche del 12 no se ocupa)', async () => {
    await reserve('2026-11-10', '2026-11-12');

    await cycle();

    expect(availabilityCalls).toEqual([[doble('2026-11-10', '2026-11-11', 2)]]);
    expect(await pendingMarks()).toBe(0);
  });

  it('escenario 2: al cancelar esa reserva, la disponibilidad vuelve a 3 el 10 y el 11', async () => {
    const reservationRef = await reserve('2026-11-10', '2026-11-12');
    await cycle();

    await cancel(reservationRef);
    await cycle();

    expect(availabilityCalls).toEqual([
      [doble('2026-11-10', '2026-11-11', 2)],
      [doble('2026-11-10', '2026-11-11', 3)],
    ]);
  });

  it('escenario 3: cinco reservas en el mismo intervalo de 30 s salen agrupadas en una sola solicitud A4, con los valores finales', async () => {
    await reserve('2026-11-10', '2026-11-12');
    await reserve('2026-11-10', '2026-11-12');
    await reserve('2026-11-11', '2026-11-13');
    await reserve('2026-11-14', '2026-11-15');
    await reserve('2026-11-14', '2026-11-16');

    await cycle();

    // Ocupadas por noche: el 10, 2; el 11, 3; el 12, 1; el 14, 2; el 15, 1. El 13 no se marcó.
    expect(availabilityCalls).toEqual([
      [
        doble('2026-11-10', '2026-11-10', 1),
        doble('2026-11-11', '2026-11-11', 0),
        doble('2026-11-12', '2026-11-12', 2),
        doble('2026-11-14', '2026-11-14', 1),
        doble('2026-11-15', '2026-11-15', 2),
      ],
    ]);
    expect(await pendingMarks()).toBe(0);
  });

  it('escenario 4: Channex no responde (503): el envío queda pendiente y sale en el ciclo siguiente; la reserva no se afecta', async () => {
    await reserve('2026-11-10', '2026-11-12');
    availabilityStatus = 503;

    await cycle();

    expect(availabilityCalls).toHaveLength(1);
    expect(await pendingMarks()).toBeGreaterThan(0);
    expect(await statuses()).toEqual(['ACTIVE']);

    availabilityStatus = 200;
    await cycle();

    expect(availabilityCalls).toEqual([
      [doble('2026-11-10', '2026-11-11', 2)],
      [doble('2026-11-10', '2026-11-11', 2)],
    ]);
    expect(await pendingMarks()).toBe(0);
    expect(await statuses()).toEqual(['ACTIVE']);
  });

  it('escenario 4: Channex limita las solicitudes (429): el envío queda pendiente, no se llama a Channex durante un minuto y después sale; la reserva no se afecta', async () => {
    // Solo la fecha es falsa, y desde que arranca la aplicación: la pausa de Channex toma `Date.now` al
    // crearse. La fecha sigue corriendo; la prueba la adelanta cuando hace falta.
    await app.close();
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
    app = await startBookingFeedApp(clock);
    await reserve('2026-11-10', '2026-11-12');
    availabilityStatus = 429;

    await cycle();
    expect(availabilityCalls).toHaveLength(1);
    expect(await pendingMarks()).toBeGreaterThan(0);

    // Dentro de la pausa, el ciclo no llama a Channex.
    availabilityStatus = 200;
    vi.setSystemTime(Date.now() + 30_000);
    await cycle();
    expect(availabilityCalls).toHaveLength(1);
    expect(await pendingMarks()).toBeGreaterThan(0);

    // Pasado el minuto, sale el envío pendiente.
    vi.setSystemTime(Date.now() + 31_000);
    await cycle();
    expect(availabilityCalls).toEqual([
      [doble('2026-11-10', '2026-11-11', 2)],
      [doble('2026-11-10', '2026-11-11', 2)],
    ]);
    expect(await pendingMarks()).toBe(0);
    expect(await statuses()).toEqual(['ACTIVE']);
  });

  it('escenario 5: el Módulo 1 avisa un mantenimiento de la 201 del 14 al 15: 2 libres el 14 y el 15, y ninguna otra fecha cambia', async () => {
    await scheduleMaintenance(ROOM_201.id, '2026-11-14', '2026-11-15');

    await cycle();

    expect(availabilityCalls).toEqual([[doble('2026-11-14', '2026-11-15', 2)]]);
    expect(await pendingMarks()).toBe(0);
  });

  it('escenario 6: la 201 con una reserva y con un mantenimiento la noche del 14: se descuenta una sola vez (2 libres)', async () => {
    await reserve('2026-11-14', '2026-11-15', ROOM_201.id);
    await cycle();

    await scheduleMaintenance(ROOM_201.id, '2026-11-14', '2026-11-14');
    await cycle();

    expect(availabilityCalls).toEqual([
      [doble('2026-11-14', '2026-11-14', 2)],
      [doble('2026-11-14', '2026-11-14', 2)],
    ]);
  });
});
