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
    request(app.getHttpServer()).post('/api/reservations/direct').send(body);

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
});
