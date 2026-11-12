import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
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
import {
  RESERVATION_REPOSITORY,
  type ReservationRepository,
} from '../../../../../src/application/ports/out/reservation.repository.js';
import { AppModule } from '../../../../../src/app.module.js';
import { configureApp } from '../../../../../src/configure-app.js';
import type { Reservation } from '../../../../../src/domain/reservation/reservation.js';
import { Money } from '../../../../../src/domain/shared/money.js';
import {
  aDirectReservation,
  aDirectRoom,
} from '../../../../support/builders.js';
import { ROOM_201, ROOM_202 } from '../../../../support/rooms.js';

/**
 * Un día operativo y una estadía lejanos, propios de esta prueba: las reservas que guarden otras pruebas en
 * la misma base no ocupan la 201 ni la 202 en estas fechas, y la recuperación del cierre del día no las
 * toca (son futuras).
 */
const TODAY = '2033-05-01';
const START = '2033-05-10';
const END = '2033-05-12';
const clock: Clock = {
  today: () => TODAY,
  now: () => new Date('2033-05-01T15:00:00.000Z'),
};

/** El Módulo 1 simulado: la 201 y la 202 de `DOBLE`; la 202 en mantenimiento si la prueba lo pide. */
let room202InMaintenance = false;
const getRoom = vi.fn<Module1Port['getRoom']>();
const module1: Partial<Module1Port> = {
  getRoom,
  // La 202 en mantenimiento cubre las fechas que se consultan, sean cuales sean.
  getMaintenances: (roomId, startDate, endDate) =>
    Promise.resolve(
      room202InMaintenance && roomId === ROOM_202.id
        ? {
            roomId,
            available: false,
            conflicts: [
              { maintenanceStart: startDate, maintenanceEnd: endDate },
            ],
          }
        : { roomId, available: true, conflicts: [] },
    ),
};

/** El Módulo 3 simulado: 300000.00 por noche. */
const createQuote = vi.fn<Module3Port['createQuote']>();
const aRateQuote = (start: string, nights: string[]): RateQuote => ({
  quoteId: `q-${start}`,
  currency: 'COP',
  nightlyRates: nights.map((date) => ({
    date,
    rate: Money.of('300000.00', 'COP'),
  })),
  lodgingAmount: Money.of(String(300000 * nights.length), 'COP'),
});

/**
 * La aplicación completa (`AppModule`) con los Módulos 1 y 3 simulados y la base de Testcontainers: comprueba
 * que `POST /api/reservations/{reservationRef}/modification-preview` (B1 de `update-reservation`, T009) está
 * conectada con `PreviewModification`, que responde la forma de B1 y que sus errores salen por el filtro
 * global. Las reglas, una por una, las prueba el servicio; los escenarios completos, la T013.
 */
describe('POST /api/reservations/{reservationRef}/modification-preview (e2e)', () => {
  let app: INestApplication<App>;
  let reservations: ReservationRepository;
  let dataSource: DataSource;

  const preview = (reservationRef: string, body: object) =>
    request(app.getHttpServer())
      .post(`/api/reservations/${reservationRef}/modification-preview`)
      .send(body);

  /**
   * Una reserva directa guardada en la 201, con 2 personas y 500000.00. La primera llega `START`; cada
   * siguiente, una semana después, para que no se crucen en la 201 (la restricción anti-solape, D3).
   */
  let stored = 0;
  const aStoredReservation = () => {
    const week = stored++;
    const shift = (date: string) => {
      const day = new Date(`${date}T00:00:00Z`);
      day.setUTCDate(day.getUTCDate() + 7 * week);
      return day.toISOString().slice(0, 10);
    };
    return reservations.insert(
      aDirectReservation({
        startDate: shift(START),
        endDate: shift(END),
        notes: 'Llegada tarde',
        rooms: [
          aDirectRoom({
            roomId: ROOM_201.id,
            roomNumber: '201',
            categoryRoom: 'DOBLE',
            guestCount: 2,
            rate: {
              roomGrossAmount: Money.of('500000.00', 'COP'),
              quoteId: 'Q-201',
            },
          }),
        ],
      }),
    );
  };

  /** El cuerpo de cambio con el `updatedAt` que guardó la base. */
  const bodyFor = (reservation: Reservation, changes: object = {}) => ({
    updatedAt: reservation.updatedAt,
    ...changes,
  });

  const rowOf = async (reservation: Reservation) => {
    const [row]: Record<string, unknown>[] = await dataSource.query(
      `SELECT start_date::text, end_date::text, guest_count, notes, updated_at::text,
              (SELECT count(*)::int FROM reservation_room rr WHERE rr.reservation_id = r.id) AS rooms
       FROM reservation r WHERE r.id = $1`,
      [reservation.id],
    );
    return row;
  };

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
    reservations = app.get<ReservationRepository>(RESERVATION_REPOSITORY);
    dataSource = app.get(DataSource);
  });

  beforeEach(() => {
    room202InMaintenance = false;
    getRoom.mockReset().mockImplementation((roomId) => {
      const room = [ROOM_201, ROOM_202].find(({ id }) => id === roomId);
      return room === undefined
        ? Promise.reject(new Error('no existe'))
        : Promise.resolve(room);
    });
    createQuote
      .mockReset()
      .mockImplementation((_roomType, checkIn) =>
        Promise.resolve(
          aRateQuote(checkIn, ['2033-05-10', '2033-05-11', '2033-05-12']),
        ),
      );
  });

  afterAll(async () => {
    await app.close();
  });

  it('cambiar las fechas y agregar la 202: responde 200 con la forma de B1, y no guarda nada', async () => {
    const reservation = await aStoredReservation();
    const before = await rowOf(reservation);

    const res = await preview(
      reservation.reservationRef,
      bodyFor(reservation, {
        endDate: '2033-05-13',
        rooms: [
          { roomId: ROOM_201.id, guestCount: 2 },
          { roomId: ROOM_202.id, guestCount: 1 },
        ],
      }),
    )
      .expect(200)
      .expect('Content-Type', /application\/json/);

    const nightlyRates = ['2033-05-10', '2033-05-11', '2033-05-12'].map(
      (date) => ({ date, rate: { amount: '300000.00', currency: 'COP' } }),
    );
    const quoted = (key: string) => ({
      key,
      categoryRoom: 'DOBLE',
      nights: 3,
      nightlyRates,
      lodgingAmount: { amount: '900000.00', currency: 'COP' },
    });
    expect(res.body).toEqual({
      reservationRef: reservation.reservationRef,
      changes: {
        dates: true,
        roomsAdded: [ROOM_202.id],
        roomsRemoved: [],
        roomsSwapped: [],
        guestCountChanged: true,
        guestChanged: false,
        notesChanged: false,
      },
      requiresConfirmation: true,
      availability: {
        rooms: [
          {
            roomId: ROOM_201.id,
            roomNumber: '201',
            available: true,
            reason: null,
          },
          {
            roomId: ROOM_202.id,
            roomNumber: '202',
            available: true,
            reason: null,
          },
        ],
      },
      quotes: {
        rooms: [quoted(ROOM_201.id), quoted(ROOM_202.id)],
        total: { amount: '1800000.00', currency: 'COP' },
      },
      reservation: { startDate: START, endDate: '2033-05-13', guestCount: 3 },
    });
    // El Módulo 3 recibe la categoría y las fechas nuevas de cada habitación.
    expect(createQuote.mock.calls).toEqual([
      ['DOBLE', START, '2033-05-13'],
      ['DOBLE', START, '2033-05-13'],
    ]);
    // La vista previa no guarda nada (B1).
    expect(await rowOf(reservation)).toEqual(before);
  });

  it('solo las observaciones: 200 sin disponibilidad ni tarifas, sin llamar a los Módulos 1 y 3', async () => {
    const reservation = await aStoredReservation();

    const res = await preview(
      reservation.reservationRef,
      bodyFor(reservation, { notes: 'Llega a las 11 p. m.' }),
    ).expect(200);

    expect(res.body).toMatchObject({
      changes: { notesChanged: true, dates: false },
      requiresConfirmation: false,
      availability: { rooms: [] },
      quotes: null,
      reservation: {
        startDate: reservation.startDate,
        endDate: reservation.endDate,
        guestCount: 2,
      },
    });
    expect(getRoom).not.toHaveBeenCalled();
    expect(createQuote).not.toHaveBeenCalled();
  });

  it.each([
    [
      'una reserva que no existe',
      async () => ({
        ref: 'RSV-0000AAAA',
        body: { updatedAt: '2033-05-01T10:00:00-05:00' },
      }),
      'RESERVATION_NOT_FOUND',
      'La reserva no existe.',
    ],
    [
      'un updatedAt viejo',
      async () => {
        const reservation = await aStoredReservation();
        return {
          ref: reservation.reservationRef,
          body: { updatedAt: '2033-05-01T10:00:00-05:00', notes: 'x' },
        };
      },
      'CONCURRENT_UPDATE',
      'Esta reserva ya fue actualizada o cancelada recientemente',
    ],
    [
      'la 202 en mantenimiento',
      async () => {
        room202InMaintenance = true;
        const reservation = await aStoredReservation();
        return {
          ref: reservation.reservationRef,
          body: bodyFor(reservation, {
            rooms: [
              { roomId: ROOM_201.id, guestCount: 2 },
              { roomId: ROOM_202.id, guestCount: 1 },
            ],
          }),
        };
      },
      'ROOM_NOT_AVAILABLE',
      'La habitación 202 no está disponible para el rango de fechas solicitado.',
    ],
    [
      'la nacionalidad del titular',
      async () => {
        const reservation = await aStoredReservation();
        return {
          ref: reservation.reservationRef,
          body: bodyFor(reservation, { guest: { nationality: 'Colombia' } }),
        };
      },
      'NATIONALITY_NOT_EDITABLE',
      'La nacionalidad no se puede modificar.',
    ],
  ])(
    'con %s responde 400 por el filtro global',
    async (_, setUp, errorCode, message) => {
      const { ref, body } = await setUp();

      const res = await preview(ref, body).expect(400);

      expect(res.body).toEqual({
        errorCode,
        message,
        timestamp: expect.any(String) as string,
        path: `/api/reservations/${ref}/modification-preview`,
      });
    },
  );
});
