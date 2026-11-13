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
  Module3UnavailableError,
} from '../../../../../src/application/ports/out/module3.port.js';
import { AppModule } from '../../../../../src/app.module.js';
import { configureApp } from '../../../../../src/configure-app.js';
import { CloseDayJob } from '../../../../../src/infrastructure/in/jobs/close-day.job.js';
import { Money } from '../../../../../src/domain/shared/money.js';
import { ROOM_201, ROOM_202 } from '../../../../support/rooms.js';

/**
 * Un día operativo y una estadía lejanos, propios de esta prueba: las reservas que guarden otras pruebas
 * en la misma base no ocupan la 201 ni la 202 en estas fechas.
 */
const TODAY = '2031-03-09';
const START_DATE = '2031-03-12';
const END_DATE = '2031-03-15';
const clock: Clock = {
  today: () => TODAY,
  now: () => new Date('2031-03-09T15:00:00.000Z'),
};

/** El Módulo 1 simulado: la 201 y la 202 de `DOBLE`; la 202 tiene un mantenimiento si la prueba lo pide. */
let room202InMaintenance = false;
const module1: Partial<Module1Port> = {
  listRoomsByCategory: () => Promise.resolve([ROOM_202, ROOM_201]),
  getMaintenances: (roomId) =>
    Promise.resolve(
      room202InMaintenance && roomId === ROOM_202.id
        ? {
            roomId,
            available: false,
            conflicts: [
              { maintenanceStart: '2031-03-13', maintenanceEnd: '2031-03-14' },
            ],
          }
        : { roomId, available: true, conflicts: [] },
    ),
};

/** El Módulo 3 simulado: 250000.00 por noche. */
const createQuote = vi.fn<Module3Port['createQuote']>();
const aRateQuote = (): RateQuote => ({
  quoteId: 'q-1',
  currency: 'COP',
  nightlyRates: ['2031-03-12', '2031-03-13', '2031-03-14'].map((date) => ({
    date,
    rate: Money.of('250000.00', 'COP'),
  })),
  lodgingAmount: Money.of('750000.00', 'COP'),
});

const BODY = {
  startDate: START_DATE,
  endDate: END_DATE,
  categoryRoom: 'DOBLE',
  rooms: [{ guestCount: 2 }, { guestCount: 2 }],
};

/**
 * La aplicación completa (`AppModule`) con los Módulos 1 y 3 simulados y la base de datos de
 * Testcontainers: comprueba que `POST /api/reservations/direct/preview` (plan de
 * `generate-direct-reservation`, A) está conectada con su caso de uso y que sus errores salen por el
 * filtro global. Los escenarios completos los prueba la T011.
 */
describe('POST /api/reservations/direct/preview (e2e)', () => {
  let app: INestApplication<App>;

  const preview = (body: object) =>
    request(app.getHttpServer())
      .post('/api/reservations/direct/preview')
      .send(body);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CLOCK)
      .useValue(clock)
      // Con el reloj fijo, el cierre del día no corre al arrancar: en la base compartida cerraría las
      // reservas que otras e2e guardaron antes de ese día (recuperación de T022 de update-reservation).
      .overrideProvider(CloseDayJob)
      .useValue({})
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
    room202InMaintenance = false;
    createQuote
      .mockReset()
      .mockImplementation(() => Promise.resolve(aRateQuote()));
  });

  afterAll(async () => {
    await app.close();
  });

  it('responde 200 con la disponibilidad, las habitaciones asignadas, las tarifas y el total', async () => {
    const res = await preview(BODY)
      .expect(200)
      .expect('Content-Type', /application\/json/);

    const nightlyRates = ['2031-03-12', '2031-03-13', '2031-03-14'].map(
      (date) => ({ date, rate: { amount: '250000.00', currency: 'COP' } }),
    );
    const free = { available: true, reason: null, message: null };
    expect(res.body).toEqual({
      availability: {
        startDate: START_DATE,
        endDate: END_DATE,
        categoryRoom: 'DOBLE',
        availableCount: 2,
        rooms: [
          { roomId: ROOM_201.id, roomNumber: '201', ...free },
          { roomId: ROOM_202.id, roomNumber: '202', ...free },
        ],
      },
      assignedRooms: [
        {
          position: 1,
          roomId: ROOM_201.id,
          roomNumber: '201',
          maxCapacity: 2,
          guestCount: 2,
        },
        {
          position: 2,
          roomId: ROOM_202.id,
          roomNumber: '202',
          maxCapacity: 3,
          guestCount: 2,
        },
      ],
      quotes: {
        rooms: ['1', '2'].map((key) => ({
          key,
          categoryRoom: 'DOBLE',
          nights: 3,
          nightlyRates,
          lodgingAmount: { amount: '750000.00', currency: 'COP' },
        })),
        total: { amount: '1500000.00', currency: 'COP' },
      },
      reservation: { guestCount: 4 },
    });
    // Se cotiza una vez por habitación, aunque sean de la misma categoría.
    expect(createQuote).toHaveBeenCalledTimes(2);
    expect(createQuote).toHaveBeenCalledWith('DOBLE', START_DATE, END_DATE);
  });

  it('no guarda nada: después de la vista previa las dos habitaciones siguen disponibles', async () => {
    await preview(BODY).expect(200);

    const res = await preview(BODY).expect(200);

    expect((res.body as { availability: unknown }).availability).toMatchObject({
      availableCount: 2,
    });
  });

  it('una entrada anterior al día operativo responde 400 START_DATE_IN_PAST sin cotizar', async () => {
    const res = await preview({ ...BODY, startDate: '2031-03-08' }).expect(400);

    expect(res.body).toEqual({
      errorCode: 'START_DATE_IN_PAST',
      message: 'La fecha de entrada no puede ser anterior a hoy.',
      timestamp: expect.any(String) as string,
      path: '/api/reservations/direct/preview',
    });
    expect(createQuote).not.toHaveBeenCalled();
  });

  it('con más habitaciones que las disponibles responde 400 NO_AVAILABILITY y el Módulo 3 no recibe ninguna llamada', async () => {
    const res = await preview({
      ...BODY,
      rooms: [{ guestCount: 1 }, { guestCount: 1 }, { guestCount: 1 }],
    }).expect(400);

    expect(res.body).toMatchObject({
      errorCode: 'NO_AVAILABILITY',
      message:
        'Error 400: La habitación no está disponible para el rango de fechas solicitado',
    });
    expect(createQuote).not.toHaveBeenCalled();
  });

  it('la habitación pedida por roomId con mantenimiento responde 400 ROOM_NOT_AVAILABLE con su número', async () => {
    room202InMaintenance = true;

    const res = await preview({
      ...BODY,
      rooms: [{ guestCount: 2, roomId: ROOM_202.id }],
    }).expect(400);

    expect(res.body).toMatchObject({
      errorCode: 'ROOM_NOT_AVAILABLE',
      message:
        'La habitación 202 no está disponible para el rango de fechas solicitado.',
    });
    expect(createQuote).not.toHaveBeenCalled();
  });

  it('si el Módulo 3 no responde: 400 PRICING_UNAVAILABLE con el mensaje literal', async () => {
    createQuote.mockRejectedValue(
      new Module3UnavailableError('tiempo agotado'),
    );

    const res = await preview(BODY).expect(400);

    expect(res.body).toMatchObject({
      errorCode: 'PRICING_UNAVAILABLE',
      message:
        'Error 400: El servicio de cotización de tarifas no se encuentra disponible. Por favor intente más tarde',
    });
  });
});
