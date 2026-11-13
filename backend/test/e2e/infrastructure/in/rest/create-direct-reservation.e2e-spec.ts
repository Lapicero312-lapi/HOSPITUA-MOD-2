import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { RateQuote } from '../../../../../src/application/integration/rate-quote.js';
import {
  CLOCK,
  type Clock,
} from '../../../../../src/application/ports/out/clock.js';
import {
  MODULE1_PORT,
  type Module1Port,
} from '../../../../../src/application/ports/out/module1.port.js';
import {
  MODULE3_PORT,
  type Module3Port,
} from '../../../../../src/application/ports/out/module3.port.js';
import { AppModule } from '../../../../../src/app.module.js';
import { configureApp } from '../../../../../src/configure-app.js';
import { Money } from '../../../../../src/domain/shared/money.js';
import { DataSource } from 'typeorm';
import { ROOM_201, ROOM_202 } from '../../../../support/rooms.js';

/**
 * Un día operativo y estadías propios de esta prueba, lejos de los de las demás: las reservas que guarden
 * otras pruebas en la misma base no ocupan la 201 ni la 202 en estas fechas, y las de aquí no ocupan las
 * de ellas.
 */
const TODAY = '2031-06-09';
const clock: Clock = {
  today: () => TODAY,
  now: () => new Date('2031-06-09T15:00:00.000Z'),
};

/** El Módulo 1 simulado: la 201 y la 202 de `DOBLE`, sin mantenimientos. */
const module1: Partial<Module1Port> = {
  listRoomsByCategory: () => Promise.resolve([ROOM_202, ROOM_201]),
  getMaintenances: (roomId) =>
    Promise.resolve({ roomId, available: true, conflicts: [] }),
};

/** El Módulo 3 simulado: 750000.00 por la estadía, con un `quoteId` distinto en cada cotización. */
let quoteNumber = 0;
const createQuote = vi.fn<Module3Port['createQuote']>();
const aRateQuote = (): RateQuote => {
  quoteNumber += 1;
  return {
    quoteId: `q-crear-${quoteNumber}`,
    currency: 'COP',
    nightlyRates: [],
    lodgingAmount: Money.of('750000.00', 'COP'),
  };
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

/** La solicitud del ejemplo de B, en las fechas `startDate` y `endDate`. */
const aBody = (startDate: string, endDate: string, changes: object = {}) => ({
  startDate,
  endDate,
  categoryRoom: 'DOBLE',
  rooms: [{ guestCount: 2 }, { guestCount: 2 }],
  guest: GUEST,
  notes: 'Llegada después de las 8 p. m.',
  expectedRates: [
    { position: 1, lodgingAmount: '750000.00', currency: 'COP' },
    { position: 2, lodgingAmount: '750000.00', currency: 'COP' },
  ],
  ...changes,
});

/**
 * La aplicación completa (`AppModule`) con los Módulos 1 y 3 simulados y la base de datos de
 * Testcontainers: comprueba que `POST /api/reservations/direct` (plan de `generate-direct-reservation`, B
 * y punto 12) está conectada con su caso de uso, que guarda la reserva y que sus errores salen por el
 * filtro global. Los escenarios completos los prueba la T011.
 */
describe('POST /api/reservations/direct (e2e)', () => {
  let app: INestApplication<App>;

  const create = (body: object) =>
    request(app.getHttpServer())
      .post('/api/reservations/direct')
      // Una clave nueva por solicitud: la creación la exige (punto 15, T019).
      .set('Idempotency-Key', randomUUID())
      .send(body);

  const preview = (startDate: string, endDate: string) =>
    request(app.getHttpServer())
      .post('/api/reservations/direct/preview')
      .send({
        startDate,
        endDate,
        categoryRoom: 'DOBLE',
        rooms: [{ guestCount: 2 }],
      });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CLOCK)
      .useValue(clock)
      .overrideProvider(MODULE1_PORT)
      .useValue(module1)
      .overrideProvider(MODULE3_PORT)
      .useValue({ createQuote })
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });

  beforeEach(() => {
    createQuote
      .mockReset()
      .mockImplementation(() => Promise.resolve(aRateQuote()));
  });

  afterAll(async () => {
    await app.close();
  });

  it('responde 201 con Location y el detalle de C3; la misma reserva se lee en GET /api/reservations/{ref}', async () => {
    const res = await create(aBody('2031-06-12', '2031-06-15')).expect(201);

    const ref: string = res.body.reservationRef;
    expect(ref).toMatch(/^RSV-[0-9A-F]{8}$/);
    expect(res.headers.location).toBe(`/api/reservations/${ref}`);
    expect(res.body).toMatchObject({
      reservationRef: ref,
      status: 'ACTIVE',
      source: 'DIRECT',
      externalConfirmationCode: null,
      startDate: '2031-06-12',
      endDate: '2031-06-15',
      nights: 3,
      guestCount: 4,
      notes: 'Llegada después de las 8 p. m.',
      guest: GUEST,
      cancellation: null,
    });
    expect(
      res.body.rooms.map(
        (room: {
          roomNumber: string;
          roomGrossAmount: object;
          stayStatus: string;
        }) => [room.roomNumber, room.roomGrossAmount, room.stayStatus],
      ),
    ).toEqual([
      ['201', { amount: '750000.00', currency: 'COP' }, 'EXPECTED'],
      ['202', { amount: '750000.00', currency: 'COP' }, 'EXPECTED'],
    ]);
    // Seis decimales y hora de Colombia: el que la pantalla reenvía al cancelar o modificar.
    expect(res.body.updatedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}-05:00$/,
    );

    const read = await request(app.getHttpServer())
      .get(`/api/reservations/${ref}`)
      .set('X-Client', 'RECEPTIONIST')
      .expect(200);
    expect(read.body).toEqual(res.body);
  });

  it('vuelve a cotizar: una cotización nueva por habitación', async () => {
    await create(aBody('2031-06-20', '2031-06-22')).expect(201);

    expect(createQuote).toHaveBeenCalledTimes(2);
  });

  it('con las habitaciones ya ocupadas responde 400 NO_AVAILABILITY y no cotiza', async () => {
    await create(aBody('2031-07-01', '2031-07-03')).expect(201);
    createQuote.mockClear();

    const res = await create(aBody('2031-07-01', '2031-07-03')).expect(400);

    expect(res.body.errorCode).toBe('NO_AVAILABILITY');
    expect(createQuote).not.toHaveBeenCalled();
  });

  it('si la tarifa cambió responde 400 RATE_CHANGED y no guarda nada', async () => {
    const res = await create(
      aBody('2031-07-10', '2031-07-12', {
        expectedRates: [
          { position: 1, lodgingAmount: '700000.00', currency: 'COP' },
          { position: 2, lodgingAmount: '750000.00', currency: 'COP' },
        ],
      }),
    ).expect(400);

    expect(res.body).toMatchObject({
      errorCode: 'RATE_CHANGED',
      message: 'La tarifa cambió, vuelva a cotizar.',
      path: '/api/reservations/direct',
    });
    const after = await preview('2031-07-10', '2031-07-12').expect(200);
    expect(after.body.availability.availableCount).toBe(2);
  });

  it('una entrada anterior al día operativo responde 400 START_DATE_IN_PAST sin cotizar', async () => {
    const res = await create(aBody('2031-06-08', '2031-06-10')).expect(400);

    expect(res.body.errorCode).toBe('START_DATE_IN_PAST');
    expect(createQuote).not.toHaveBeenCalled();
  });

  it('sin titular responde 400 GUEST_DATA_REQUIRED', async () => {
    const res = await create(
      aBody('2031-07-20', '2031-07-22', { guest: undefined }),
    ).expect(400);

    expect(res.body.errorCode).toBe('GUEST_DATA_REQUIRED');
  });

  describe('los avisos, en la misma transacción (T010)', () => {
    const database = () => app.get(DataSource);

    const ariChanges = (from: string) =>
      database().query(
        `SELECT category_room, to_char(date_from, 'YYYY-MM-DD') AS date_from,
                to_char(date_to, 'YYYY-MM-DD') AS date_to
         FROM ari_pending_change WHERE date_from = $1`,
        [from],
      );

    const dailyMessagesOf = (reservationRef: string) =>
      database().query(
        `SELECT m.update_type FROM daily_list_message m
         JOIN reservation r ON r.id = m.reservation_id
         WHERE r.reservation_ref = $1`,
        [reservationRef],
      );

    it('deja la marca para Channex con la categoría y las noches, y con llegada futura no avisa a la lista', async () => {
      const res = await create(aBody('2031-08-01', '2031-08-04')).expect(201);

      expect(await ariChanges('2031-08-01')).toEqual([
        {
          category_room: 'DOBLE',
          date_from: '2031-08-01',
          date_to: '2031-08-04',
        },
      ]);
      expect(await dailyMessagesOf(res.body.reservationRef)).toEqual([]);
    });

    it('con llegada hoy y la lista del día ya enviada, avisa ADDED (regla 8)', async () => {
      await database().query(
        `INSERT INTO daily_sequence (operational_date, last_sequence, list_generated)
         VALUES ($1, 1, true)
         ON CONFLICT (operational_date) DO UPDATE SET list_generated = true`,
        [TODAY],
      );

      const res = await create(
        aBody(TODAY, '2031-06-10', {
          rooms: [{ guestCount: 2 }],
          expectedRates: [
            { position: 1, lodgingAmount: '750000.00', currency: 'COP' },
          ],
        }),
      ).expect(201);

      expect(await dailyMessagesOf(res.body.reservationRef)).toEqual([
        { update_type: 'ADDED' },
      ]);
    });

    it('si la creación falla, no queda ninguna marca para Channex', async () => {
      await create(
        aBody('2031-08-20', '2031-08-22', {
          expectedRates: [
            { position: 1, lodgingAmount: '1.00', currency: 'COP' },
            { position: 2, lodgingAmount: '750000.00', currency: 'COP' },
          ],
        }),
      ).expect(400);

      expect(await ariChanges('2031-08-20')).toEqual([]);
    });
  });

  describe('la Idempotency-Key (escenario 8, T019)', () => {
    const createWith = (body: object, key?: string) => {
      const req = request(app.getHttpServer()).post('/api/reservations/direct');
      return (key === undefined ? req : req.set('Idempotency-Key', key)).send(
        body,
      );
    };

    it('escenario 8: el doble envío con la misma clave responde la misma reserva, sin crear otra ni volver a cotizar', async () => {
      const key = randomUUID();
      const body = aBody('2031-09-01', '2031-09-03');

      const first = await createWith(body, key).expect(201);
      createQuote.mockClear();
      const second = await createWith(body, key).expect(201);

      expect(second.body).toEqual(first.body);
      expect(second.headers.location).toBe(first.headers.location);
      expect(createQuote).not.toHaveBeenCalled();
      const [{ count }]: { count: number }[] = await app
        .get(DataSource)
        .query(
          `SELECT count(*)::int AS count FROM reservation WHERE start_date = '2031-09-01'`,
        );
      expect(count).toBe(1);
    });

    it('la misma clave con otro cuerpo: 400 IDEMPOTENCY_KEY_REUSED', async () => {
      const key = randomUUID();
      await createWith(aBody('2031-09-10', '2031-09-12'), key).expect(201);

      const res = await createWith(
        aBody('2031-09-10', '2031-09-12', { notes: 'Otra nota' }),
        key,
      ).expect(400);

      expect(res.body).toMatchObject({
        errorCode: 'IDEMPOTENCY_KEY_REUSED',
        message: 'La solicitud ya se usó con otros datos.',
      });
    });

    it.each([
      ['sin la cabecera', undefined],
      ['con una que no es un UUID', 'doble-clic'],
    ])('%s: 400 IDEMPOTENCY_KEY_REQUIRED', async (_, key) => {
      const res = await createWith(
        aBody('2031-09-20', '2031-09-22'),
        key,
      ).expect(400);

      expect(res.body).toMatchObject({
        errorCode: 'IDEMPOTENCY_KEY_REQUIRED',
        message: 'Falta el identificador de la solicitud.',
      });
    });
  });
});
