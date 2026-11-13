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
import { CloseDayJob } from '../../../../../src/infrastructure/in/jobs/close-day.job.js';
import {
  aDirectReservation,
  aDirectRoom,
} from '../../../../support/builders.js';
import { ROOM_201, ROOM_202 } from '../../../../support/rooms.js';

/**
 * Un día operativo y unas estadías de 2036, propios de esta prueba: las reservas que guarden otras pruebas
 * en la misma base no ocupan la 201 ni la 202 en estas fechas.
 */
const TODAY = '2036-05-01';
const START = '2036-05-10';
const END = '2036-05-12';
const clock: Clock = {
  today: () => TODAY,
  now: () => new Date('2036-05-01T15:00:00.000Z'),
};

/**
 * El Módulo 1 simulado: la 201 y la 202 de `DOBLE`, sin mantenimientos. Con `takeRoom202`, al consultar los
 * mantenimientos de la 202 otra reserva la ocupa en esas fechas: la revisión local de la disponibilidad ya
 * pasó, así que la confirmación llega a la restricción anti-solape de la base (D3).
 */
let takeRoom202:
  ((startDate: string, endDate: string) => Promise<void>) | null = null;
const getRoom = vi.fn<Module1Port['getRoom']>();
const module1: Partial<Module1Port> = {
  getRoom,
  getMaintenances: async (roomId, startDate, endDate) => {
    if (takeRoom202 !== null && roomId === ROOM_202.id) {
      await takeRoom202(startDate, endDate);
    }
    return { roomId, available: true, conflicts: [] };
  },
};

/** El Módulo 3 simulado: `nightly` por noche (300000.00 salvo que la prueba lo cambie). */
let nightly = '300000.00';
let quoteNumber = 0;
const createQuote = vi.fn<Module3Port['createQuote']>();
const aRateQuote = (start: string, end: string): RateQuote => {
  const nights: string[] = [];
  for (
    let day = new Date(`${start}T00:00:00Z`);
    day < new Date(`${end}T00:00:00Z`);
    day.setUTCDate(day.getUTCDate() + 1)
  ) {
    nights.push(day.toISOString().slice(0, 10));
  }
  quoteNumber += 1;
  return {
    quoteId: `q-confirmar-${quoteNumber}`,
    currency: 'COP',
    nightlyRates: nights.map((date) => ({
      date,
      rate: Money.of(nightly, 'COP'),
    })),
    lodgingAmount: Money.of(
      (Number(nightly) * nights.length).toFixed(2),
      'COP',
    ),
  };
};

type QuotedRoom = {
  key: string;
  lodgingAmount: { amount: string; currency: string };
};
type DetailRoom = {
  roomId: string;
  roomNumber: string;
  guestCount: number;
  roomGrossAmount: { amount: string; currency: string };
  stayStatus: string;
};

/**
 * La aplicación completa (`AppModule`) con los Módulos 1 y 3 simulados y la base de Testcontainers: comprueba
 * que `PATCH /api/reservations/{reservationRef}` (B2 de `update-reservation`, T010 a T012) está conectada
 * con `ConfirmModification`, que guarda lo que mostró la vista previa, que avisa a la lista del día en su
 * transacción, que la restricción anti-solape responde `ROOM_NOT_AVAILABLE` y que sus errores salen por el
 * filtro global. Las reglas, una por una, las prueba el servicio; los escenarios completos, la T013.
 */
describe('PATCH /api/reservations/{reservationRef} (e2e)', () => {
  let app: INestApplication<App>;
  let reservations: ReservationRepository;
  let dataSource: DataSource;

  const preview = (reservationRef: string, body: object) =>
    request(app.getHttpServer())
      .post(`/api/reservations/${reservationRef}/modification-preview`)
      .send(body);
  const confirm = (reservationRef: string, body: object) =>
    request(app.getHttpServer())
      .patch(`/api/reservations/${reservationRef}`)
      .send(body);
  const detailOf = (reservationRef: string) =>
    request(app.getHttpServer())
      .get(`/api/reservations/${reservationRef}`)
      .set('X-Client', 'RECEPTIONIST');

  /**
   * Una reserva directa guardada en la 201, con 2 personas y 500000.00. Cada una, dos semanas después de la
   * anterior, para que no se crucen en la 201 ni en la 202 (D3).
   */
  let stored = 0;
  const shifted = (date: string, weeks: number) => {
    const day = new Date(`${date}T00:00:00Z`);
    day.setUTCDate(day.getUTCDate() + 14 * weeks);
    return day.toISOString().slice(0, 10);
  };
  const aStoredReservation = (
    changes: { startDate?: string; endDate?: string } = {},
  ) => {
    const weeks = stored++;
    return reservations.insert(
      aDirectReservation({
        startDate: shifted(START, weeks),
        endDate: shifted(END, weeks),
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
        ...changes,
      }),
    );
  };

  /** El cuerpo de cambio con el `updatedAt` que leyó la pantalla. */
  const bodyFor = (updatedAt: string | null, changes: object = {}) => ({
    updatedAt,
    ...changes,
  });

  /** Las tarifas que vio el solicitante, tal como las mostró la vista previa. */
  const expectedRatesOf = (previewBody: {
    quotes: { rooms: QuotedRoom[] } | null;
  }) =>
    (previewBody.quotes?.rooms ?? []).map(({ key, lodgingAmount }) => ({
      roomId: key,
      lodgingAmount: lodgingAmount.amount,
      currency: lodgingAmount.currency,
    }));

  const roomRowsOf = (reservation: Reservation) =>
    dataSource.query(
      `SELECT room_number, guest_count, room_gross_amount::text AS amount, quote_id,
              start_date::text AS start_date, end_date::text AS end_date, blocks_inventory
       FROM reservation_room WHERE reservation_id = $1 ORDER BY room_number`,
      [reservation.id],
    );

  const reservationRowOf = async (reservation: Reservation) => {
    const [row]: Record<string, unknown>[] = await dataSource.query(
      `SELECT start_date::text, end_date::text, guest_count, notes, updated_at::text
       FROM reservation WHERE id = $1`,
      [reservation.id],
    );
    return row;
  };

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
    reservations = app.get<ReservationRepository>(RESERVATION_REPOSITORY);
    dataSource = app.get(DataSource);
  });

  beforeEach(() => {
    takeRoom202 = null;
    nightly = '300000.00';
    getRoom.mockReset().mockImplementation((roomId) => {
      const room = [ROOM_201, ROOM_202].find(({ id }) => id === roomId);
      return room === undefined
        ? Promise.reject(new Error('no existe'))
        : Promise.resolve(room);
    });
    createQuote
      .mockReset()
      .mockImplementation((_roomType, checkIn, checkOut) =>
        Promise.resolve(aRateQuote(checkIn, checkOut)),
      );
  });

  afterAll(async () => {
    await app.close();
  });

  it('confirma lo que mostró la vista previa: guarda las cotizaciones nuevas, la suma es el total y responde el detalle de C3 con su updatedAt nuevo', async () => {
    const reservation = await aStoredReservation();
    const endDate = shifted('2036-05-13', 0);
    const change = {
      endDate,
      rooms: [
        { roomId: ROOM_201.id, guestCount: 2 },
        { roomId: ROOM_202.id, guestCount: 1 },
      ],
    };
    const shown = await preview(
      reservation.reservationRef,
      bodyFor(reservation.updatedAt, change),
    ).expect(200);
    createQuote.mockClear();

    const res = await confirm(
      reservation.reservationRef,
      bodyFor(reservation.updatedAt, {
        ...change,
        expectedRates: expectedRatesOf(shown.body),
      }),
    )
      .expect(200)
      .expect('Content-Type', /application\/json/);

    // Vuelve a cotizar las dos (B2: el servidor vuelve a cotizar y compara).
    expect(createQuote).toHaveBeenCalledTimes(2);
    expect(res.body).toMatchObject({
      reservationRef: reservation.reservationRef,
      startDate: START,
      endDate,
      nights: 3,
      guestCount: 3,
    });
    expect(
      (res.body.rooms as DetailRoom[]).map(
        ({ roomNumber, guestCount, roomGrossAmount, stayStatus }) => [
          roomNumber,
          guestCount,
          roomGrossAmount.amount,
          stayStatus,
        ],
      ),
    ).toEqual([
      ['201', 2, '900000.00', 'EXPECTED'],
      ['202', 1, '900000.00', 'EXPECTED'],
    ]);
    // La suma de lo guardado es el total que mostró la vista previa.
    const saved = (res.body.rooms as DetailRoom[]).reduce(
      (sum, { roomGrossAmount }) => sum + Number(roomGrossAmount.amount),
      0,
    );
    expect(saved.toFixed(2)).toBe(shown.body.quotes.total.amount);
    // El updatedAt nuevo, y la misma reserva que lee GET /api/reservations/{ref}.
    expect(res.body.updatedAt).not.toBe(reservation.updatedAt);
    const read = await detailOf(reservation.reservationRef).expect(200);
    expect(read.body).toEqual(res.body);
    // En la base: las cotizaciones nuevas de la confirmación (no las de la vista previa) y las copias de
    // las fechas en cada habitación.
    expect(await roomRowsOf(reservation)).toEqual([
      {
        room_number: '201',
        guest_count: 2,
        amount: '900000.00',
        quote_id: 'q-confirmar-' + String(quoteNumber - 1),
        start_date: START,
        end_date: endDate,
        blocks_inventory: true,
      },
      {
        room_number: '202',
        guest_count: 1,
        amount: '900000.00',
        quote_id: 'q-confirmar-' + String(quoteNumber),
        start_date: START,
        end_date: endDate,
        blocks_inventory: true,
      },
    ]);
  });

  it('si la tarifa cambió desde la vista previa: 400 RATE_CHANGED y no guarda nada', async () => {
    const reservation = await aStoredReservation();
    const change = {
      rooms: [
        { roomId: ROOM_201.id, guestCount: 2 },
        { roomId: ROOM_202.id, guestCount: 1 },
      ],
    };
    const shown = await preview(
      reservation.reservationRef,
      bodyFor(reservation.updatedAt, change),
    ).expect(200);
    const before = await reservationRowOf(reservation);
    nightly = '310000.00';

    const res = await confirm(
      reservation.reservationRef,
      bodyFor(reservation.updatedAt, {
        ...change,
        expectedRates: expectedRatesOf(shown.body),
      }),
    ).expect(400);

    expect(res.body).toMatchObject({
      errorCode: 'RATE_CHANGED',
      message: 'La tarifa cambió, vuelva a cotizar.',
      path: `/api/reservations/${reservation.reservationRef}`,
    });
    expect(await reservationRowOf(reservation)).toEqual(before);
    expect(await roomRowsOf(reservation)).toHaveLength(1);
  });

  it('cambiar la 201 por la 202 (la misma categoría): no llama al Módulo 3 y la 202 hereda la tarifa y el quoteId', async () => {
    const reservation = await aStoredReservation();

    await confirm(
      reservation.reservationRef,
      bodyFor(reservation.updatedAt, {
        rooms: [{ roomId: ROOM_202.id, guestCount: 2 }],
      }),
    ).expect(200);

    expect(createQuote).not.toHaveBeenCalled();
    expect(await roomRowsOf(reservation)).toEqual([
      expect.objectContaining({
        room_number: '202',
        amount: '500000.00',
        quote_id: 'Q-201',
      }),
    ]);
  });

  it('solo las observaciones: guarda sin llamar a los Módulos 1 ni 3', async () => {
    const reservation = await aStoredReservation();

    const res = await confirm(
      reservation.reservationRef,
      bodyFor(reservation.updatedAt, { notes: 'Llega a las 11 p. m.' }),
    ).expect(200);

    expect(res.body.notes).toBe('Llega a las 11 p. m.');
    expect(getRoom).not.toHaveBeenCalled();
    expect(createQuote).not.toHaveBeenCalled();
  });

  it('con el updatedAt de antes de la confirmación: 400 CONCURRENT_UPDATE por el filtro global', async () => {
    const reservation = await aStoredReservation();
    await confirm(
      reservation.reservationRef,
      bodyFor(reservation.updatedAt, { notes: 'Primera' }),
    ).expect(200);

    const res = await confirm(
      reservation.reservationRef,
      bodyFor(reservation.updatedAt, { notes: 'Segunda' }),
    ).expect(400);

    expect(res.body).toMatchObject({
      errorCode: 'CONCURRENT_UPDATE',
      message: 'Esta reserva ya fue actualizada o cancelada recientemente',
    });
    expect((await reservationRowOf(reservation)).notes).toBe('Primera');
  });

  it('si la restricción anti-solape rechaza la 202: 400 ROOM_NOT_AVAILABLE con su número, y no queda nada a medias', async () => {
    const reservation = await aStoredReservation();
    const before = await reservationRowOf(reservation);
    // Otra reserva toma la 202 después de la revisión local de la disponibilidad.
    takeRoom202 = async (startDate, endDate) => {
      takeRoom202 = null;
      await reservations.insert(
        aDirectReservation({
          startDate,
          endDate,
          rooms: [
            aDirectRoom({
              roomId: ROOM_202.id,
              roomNumber: '202',
              categoryRoom: 'DOBLE',
            }),
          ],
        }),
      );
    };

    const res = await confirm(
      reservation.reservationRef,
      bodyFor(reservation.updatedAt, {
        rooms: [
          { roomId: ROOM_201.id, guestCount: 2 },
          { roomId: ROOM_202.id, guestCount: 1 },
        ],
        expectedRates: [
          {
            roomId: ROOM_202.id,
            lodgingAmount: '600000.00',
            currency: 'COP',
          },
        ],
      }),
    ).expect(400);

    expect(res.body).toMatchObject({
      errorCode: 'ROOM_NOT_AVAILABLE',
      message:
        'La habitación 202 no está disponible para el rango de fechas solicitado.',
    });
    expect(await reservationRowOf(reservation)).toEqual(before);
    expect(await roomRowsOf(reservation)).toEqual([
      expect.objectContaining({ room_number: '201', quote_id: 'Q-201' }),
    ]);
  });

  it('con llegada hoy y la lista del día ya enviada: avisa UPDATED en la misma transacción', async () => {
    await dataSource.query(
      `INSERT INTO daily_sequence (operational_date, last_sequence, list_generated)
       VALUES ($1, 1, true)
       ON CONFLICT (operational_date) DO UPDATE SET list_generated = true`,
      [TODAY],
    );
    const reservation = await aStoredReservation({
      startDate: TODAY,
      endDate: '2036-05-03',
    });

    await confirm(
      reservation.reservationRef,
      bodyFor(reservation.updatedAt, { notes: 'Llega a las 11 p. m.' }),
    ).expect(200);

    const messages: { update_type: string }[] = await dataSource.query(
      `SELECT update_type FROM daily_list_message WHERE reservation_id = $1`,
      [reservation.id],
    );
    expect(messages).toEqual([{ update_type: 'UPDATED' }]);
  });

  it('una reserva que no existe: 400 RESERVATION_NOT_FOUND por el filtro global', async () => {
    const res = await confirm(
      'RSV-FFFFFFFF',
      bodyFor('2036-05-01T10:00:00.000000-05:00', { notes: 'x' }),
    ).expect(400);

    expect(res.body).toMatchObject({
      errorCode: 'RESERVATION_NOT_FOUND',
      message: 'La reserva no existe.',
      path: '/api/reservations/RSV-FFFFFFFF',
    });
  });
});
