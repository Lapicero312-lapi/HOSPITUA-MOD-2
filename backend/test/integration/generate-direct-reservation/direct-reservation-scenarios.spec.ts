import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
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
} from 'vitest';
import type { Room } from '../../../src/application/integration/room.js';
import { CLOCK, type Clock } from '../../../src/application/ports/out/clock.js';
import {
  GENERATE_DAILY_LIST,
  type GenerateDailyList,
} from '../../../src/application/use-cases/check-view-reservation/ports/in/generate-daily-list.port.js';
import { configureApp } from '../../../src/configure-app.js';
import type { EnvironmentVariables } from '../../../src/infrastructure/config/env.validation.js';
import { integrationEnv, truncateAllTables } from '../support/database.js';

/**
 * T011 de `generate-direct-reservation`: los escenarios 1 a 7 y 9 de la historia 1, con la aplicación
 * completa, PostgreSQL y RabbitMQ reales, y los Módulos 1 y 3 simulados en HTTP (msw), así que sus clientes
 * y sus errores también son los reales. El escenario 8 (doble envío) es de T019 y los 10 y 11 (precarga del
 * titular), de T018.
 */

/** Las habitaciones de los escenarios 5 y 6: la 101 y la 102 de `DOBLE`, de capacidad 2. */
const ROOM_101: Room = {
  id: '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c01',
  roomNumber: '101',
  categoryRoom: 'DOBLE',
  maxCapacity: 2,
};
const ROOM_102: Room = {
  id: '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c02',
  roomNumber: '102',
  categoryRoom: 'DOBLE',
  maxCapacity: 2,
};

/** Lo que cotiza el Módulo 3 por habitación y estadía. */
const LODGING = '500000.00';

/** El día operativo de cada caso: se cambia en el escenario 9. */
let today = '2032-09-28';
const clock: Clock = {
  today: () => today,
  now: () => new Date(`${today}T15:00:00.000Z`),
};

const GUEST = {
  firstName: 'Valentina',
  lastName: 'Ospina',
  documentType: 'CC',
  documentNumber: '1144093552',
  nationality: 'Colombia',
  contactPhone: '+57 300 000 0000',
  contactEmail: 'valentina@correo.com',
};

/** El cuerpo de B con una habitación de 2 personas por cada `rooms`, y sus tarifas. */
const aBody = (
  startDate: string,
  endDate: string,
  rooms: { guestCount: number; roomId?: string }[] = [{ guestCount: 2 }],
) => ({
  startDate,
  endDate,
  categoryRoom: 'DOBLE',
  rooms,
  guest: GUEST,
  notes: null,
  expectedRates: rooms.map((_, index) => ({
    position: index + 1,
    lodgingAmount: LODGING,
    currency: 'COP',
  })),
});

const server = setupServer();

describe('Generar reserva directa: escenarios 1 a 7 y 9 de la historia 1 (T011)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let module1Url: string;
  let module3Url: string;
  /** Las habitaciones con mantenimiento en la estadía pedida. */
  let inMaintenance: string[] = [];
  let quoteCalls = 0;
  let module3Down = false;

  const create = (body: object) =>
    request(app.getHttpServer()).post('/api/reservations/direct').send(body);

  const reservationsSaved = async (): Promise<number> => {
    const [{ count }]: { count: number }[] = await dataSource.query(
      'SELECT count(*)::int AS count FROM reservation',
    );
    return count;
  };

  const dailyUpdates = (): Promise<
    { update_type: string; reservation_ref: string }[]
  > =>
    dataSource.query(
      `SELECT m.update_type, r.reservation_ref FROM daily_list_message m
       JOIN reservation r ON r.id = m.reservation_id
       WHERE m.message_kind = 'UPDATE' ORDER BY m.sequence_number`,
    );

  /** El Módulo 1 con la 101 y la 102; las de `inMaintenance` tienen un mantenimiento en la estadía. */
  function module1Answering(): void {
    server.use(
      http.get(`${module1Url}/api/rooms`, () =>
        HttpResponse.json([ROOM_101, ROOM_102]),
      ),
      http.get(`${module1Url}/api/rooms/:roomId`, ({ params }) => {
        const room = [ROOM_101, ROOM_102].find(
          ({ id }) => id === params.roomId,
        );
        return room === undefined
          ? HttpResponse.json({ errorCode: 'ROOM_NOT_FOUND' }, { status: 404 })
          : HttpResponse.json(room);
      }),
      http.get(
        `${module1Url}/api/rooms/:roomId/maintenances`,
        ({ params, request: req }) => {
          const url = new URL(req.url);
          const busy = inMaintenance.includes(String(params.roomId));
          return HttpResponse.json({
            roomId: params.roomId,
            available: !busy,
            conflicts: busy
              ? [
                  {
                    maintenanceStart: url.searchParams.get('startDate'),
                    maintenanceEnd: url.searchParams.get('endDate'),
                  },
                ]
              : [],
          });
        },
      ),
    );
  }

  /** El Módulo 3: `LODGING` por la estadía, con un `quoteId` nuevo cada vez; o caído. */
  function module3Answering(): void {
    server.use(
      http.post(`${module3Url}/pricing/quotes`, () => {
        quoteCalls += 1;
        if (module3Down) {
          return HttpResponse.json({}, { status: 503 });
        }
        return HttpResponse.json({
          quoteId: `00000000-0000-4000-8000-${String(quoteCalls).padStart(12, '0')}`,
          currency: 'COP',
          nightlyRates: [],
          lodgingAmount: LODGING,
        });
      }),
    );
  }

  beforeAll(async () => {
    // AppConfigModule lee el entorno al importarse: AppModule se importa después de asignarlo.
    Object.assign(process.env, { NODE_ENV: 'test', ...integrationEnv() });
    const { AppModule } = await import('../../../src/app.module.js');
    server.listen({ onUnhandledRequest: 'bypass' });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CLOCK)
      .useValue(clock)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    dataSource = app.get(DataSource);
    const config =
      app.get<ConfigService<EnvironmentVariables, true>>(ConfigService);
    module1Url = config.get('MODULE1_BASE_URL', { infer: true });
    module3Url = config.get('MODULE3_BASE_URL', { infer: true });
  });

  beforeEach(async () => {
    today = '2032-09-28';
    inMaintenance = [];
    quoteCalls = 0;
    module3Down = false;
    await truncateAllTables(dataSource);
    module1Answering();
    module3Answering();
  });

  afterEach(() => {
    server.resetHandlers();
  });

  afterAll(async () => {
    server.close();
    await app?.close();
  });

  it('escenario 1: llegada hoy, con la lista ya enviada: ACTIVE, tarifa y quoteId en la habitación, comisión 0, sin código externo y el ADDED', async () => {
    await app.get<GenerateDailyList>(GENERATE_DAILY_LIST).execute(today);

    const res = await create(aBody(today, '2032-09-30')).expect(201);

    expect(res.body).toMatchObject({
      status: 'ACTIVE',
      source: 'DIRECT',
      externalConfirmationCode: null,
      rooms: [
        {
          roomNumber: '101',
          roomGrossAmount: { amount: LODGING, currency: 'COP' },
          stayStatus: 'EXPECTED',
        },
      ],
    });
    const [saved]: {
      commission_percentage: string;
      commission_amount: string;
      quote_id: string;
    }[] = await dataSource.query(
      `SELECT r.commission_percentage::text, r.commission_amount::text, rr.quote_id
       FROM reservation r JOIN reservation_room rr ON rr.reservation_id = r.id`,
    );
    expect(Number(saved.commission_percentage)).toBe(0);
    expect(Number(saved.commission_amount)).toBe(0);
    expect(saved.quote_id).toBe('00000000-0000-4000-8000-000000000001');
    expect(await dailyUpdates()).toEqual([
      { update_type: 'ADDED', reservation_ref: res.body.reservationRef },
    ]);
  });

  it('escenario 2: las habitaciones ocupadas o en mantenimiento: 400 NO_AVAILABILITY con el literal del spec, sin cotizar', async () => {
    inMaintenance = [ROOM_101.id, ROOM_102.id];

    const res = await create(aBody('2032-10-10', '2032-10-12')).expect(400);

    expect(res.body).toMatchObject({
      errorCode: 'NO_AVAILABILITY',
      message:
        'Error 400: La habitación no está disponible para el rango de fechas solicitado',
    });
    expect(quoteCalls).toBe(0);
    expect(await reservationsSaved()).toBe(0);
  });

  it('escenario 2: con una reserva cruzada en las dos habitaciones, también NO_AVAILABILITY', async () => {
    await create(
      aBody('2032-10-10', '2032-10-12', [{ guestCount: 2 }, { guestCount: 2 }]),
    ).expect(201);
    quoteCalls = 0;

    const res = await create(aBody('2032-10-11', '2032-10-13')).expect(400);

    expect(res.body.errorCode).toBe('NO_AVAILABILITY');
    expect(quoteCalls).toBe(0);
  });

  it('escenario 3: el Módulo 3 no responde: 400 PRICING_UNAVAILABLE con el literal del spec, y no se guarda nada', async () => {
    module3Down = true;

    const res = await create(aBody('2032-10-10', '2032-10-12')).expect(400);

    expect(res.body).toMatchObject({
      errorCode: 'PRICING_UNAVAILABLE',
      message:
        'Error 400: El servicio de cotización de tarifas no se encuentra disponible. Por favor intente más tarde',
    });
    expect(await reservationsSaved()).toBe(0);
  });

  it('escenario 4: llegada futura: 201 sin avisar al Módulo 1, y la reserva viaja en la lista del día de su llegada', async () => {
    await app.get<GenerateDailyList>(GENERATE_DAILY_LIST).execute(today);

    const res = await create(aBody('2032-10-20', '2032-10-22')).expect(201);

    expect(await dailyUpdates()).toEqual([]);
    await app.get<GenerateDailyList>(GENERATE_DAILY_LIST).execute('2032-10-20');
    const [{ refs }]: { refs: string[] }[] = await dataSource.query(
      `SELECT array(SELECT jsonb_array_elements(payload->'reservations')->>'reservationRef') AS refs
       FROM daily_list_message WHERE operational_date = '2032-10-20' AND message_kind = 'LIST'`,
    );
    expect(refs).toEqual([res.body.reservationRef]);
  });

  it('escenario 5: un grupo con la 101 y la 102, 2 personas en cada una: una sola reserva con dos habitaciones EXPECTED y su tarifa, sin total', async () => {
    const res = await create(
      aBody('2032-10-10', '2032-10-12', [
        { guestCount: 2, roomId: ROOM_101.id },
        { guestCount: 2, roomId: ROOM_102.id },
      ]),
    ).expect(201);

    expect(res.body).toMatchObject({ status: 'ACTIVE', guestCount: 4 });
    expect(
      res.body.rooms.map(
        (room: {
          roomNumber: string;
          stayStatus: string;
          roomGrossAmount: unknown;
        }) => [room.roomNumber, room.stayStatus, room.roomGrossAmount],
      ),
    ).toEqual([
      ['101', 'EXPECTED', { amount: LODGING, currency: 'COP' }],
      ['102', 'EXPECTED', { amount: LODGING, currency: 'COP' }],
    ]);
    expect(res.body).not.toHaveProperty('total');
    expect(await reservationsSaved()).toBe(1);
  });

  it('escenario 6: la 102 con mantenimiento: 400 ROOM_NOT_AVAILABLE con su número, y no se crea la reserva', async () => {
    inMaintenance = [ROOM_102.id];

    const res = await create(
      aBody('2032-10-10', '2032-10-12', [
        { guestCount: 2, roomId: ROOM_101.id },
        { guestCount: 2, roomId: ROOM_102.id },
      ]),
    ).expect(400);

    expect(res.body).toMatchObject({
      errorCode: 'ROOM_NOT_AVAILABLE',
      message:
        'La habitación 102 no está disponible para el rango de fechas solicitado.',
    });
    expect(await reservationsSaved()).toBe(0);
  });

  it.each([
    [
      3,
      'GUEST_COUNT_EXCEEDS_CAPACITY',
      'La cantidad de personas supera la capacidad de la habitación.',
    ],
    [
      0,
      'GUEST_COUNT_TOO_LOW',
      'Cada habitación debe tener al menos una persona.',
    ],
  ])(
    'escenario 7: %i personas en una habitación de capacidad 2: 400 %s',
    async (guestCount, errorCode, message) => {
      const res = await create(
        aBody('2032-10-10', '2032-10-12', [{ guestCount }, { guestCount: 2 }]),
      ).expect(400);

      expect(res.body).toMatchObject({ errorCode, message });
      expect(await reservationsSaved()).toBe(0);
    },
  );

  describe('escenario 9: la fecha de entrada no puede ser anterior al día operativo', () => {
    it('con hoy en el 2026-09-28 (aquí, 2032-09-28): el 27 se rechaza con el literal del spec', async () => {
      const res = await create(aBody('2032-09-27', '2032-09-29')).expect(400);

      expect(res.body).toMatchObject({
        errorCode: 'START_DATE_IN_PAST',
        message: 'La fecha de entrada no puede ser anterior a hoy.',
      });
      expect(quoteCalls).toBe(0);
    });

    it('el 28 se acepta', async () => {
      await create(aBody('2032-09-28', '2032-09-30')).expect(201);
    });

    it('al día siguiente, el 28 ya se rechaza: el mínimo sale del Clock, no de una fecha fija', async () => {
      today = '2032-09-29';

      const res = await create(aBody('2032-09-28', '2032-09-30')).expect(400);

      expect(res.body.errorCode).toBe('START_DATE_IN_PAST');
    });
  });
});
