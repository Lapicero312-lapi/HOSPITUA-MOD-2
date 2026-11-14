import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
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
  vi,
} from 'vitest';
import {
  CANCELLATION_REPOSITORY,
  type CancellationRepository,
} from '../../../src/application/ports/out/cancellation.repository.js';
import {
  OTA_REPOSITORY,
  type OtaRepository,
} from '../../../src/application/ports/out/ota.repository.js';
import {
  RESERVATION_QUERY_PORT,
  type ReservationQueryPort,
} from '../../../src/application/ports/out/reservation-query.port.js';
import {
  RESERVATION_REPOSITORY,
  type ReservationRepository,
} from '../../../src/application/ports/out/reservation.repository.js';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../src/application/ports/out/transaction.js';
import { configureApp } from '../../../src/configure-app.js';
import { Cancellation } from '../../../src/domain/cancellation/cancellation.js';
import type { Reservation } from '../../../src/domain/reservation/reservation.js';
import {
  aDirectReservation,
  aDirectRoom,
  aGuest,
  anOta,
  anOtaReservation,
  otaTerms,
} from '../../support/builders.js';
import { integrationEnv, truncateAllTables } from '../support/database.js';

const LIST = '/api/reservations';

const INVALID_CODE = {
  errorCode: 'INVALID_RESERVATION_CODE',
  message: 'Debe proveer un código de reserva válido para la consulta.',
};
const NOT_FOUND = {
  errorCode: 'RESERVATION_NOT_FOUND',
  message: 'La reserva no existe.',
};

/**
 * T018 de `check-view-reservation`: los escenarios 1 a 6 de la historia 2 del spec (la búsqueda por código
 * y el detalle completo), con lo que pide su fila en "Pruebas por escenario" del plan. Todo es real: la
 * aplicación completa (`AppModule`), `GET /api/reservations?search=` (C1) y
 * `GET /api/reservations/{reservationRef}` (C3) con `X-Client: RECEPTIONIST`, y PostgreSQL. La base empieza
 * vacía en cada prueba.
 */
describe('check-view-reservation: escenarios 1 a 6 de la historia 2, la búsqueda por código y el detalle (T018)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let reservations: ReservationRepository;

  const search = (code: string, query: Record<string, string> = {}) =>
    request(app.getHttpServer())
      .get(LIST)
      .set('X-Client', 'RECEPTIONIST')
      .query({ search: code, ...query });

  const detail = (reservationRef: string) =>
    request(app.getHttpServer())
      .get(`${LIST}/${encodeURIComponent(reservationRef)}`)
      .set('X-Client', 'RECEPTIONIST');

  const refsOf = (body: { items: { reservationRef: string }[] }) =>
    body.items.map(({ reservationRef }) => reservationRef);

  /** Una agencia guardada, con un nombre propio de esta prueba. */
  const anAgency = async (name: string) =>
    app.get<OtaRepository>(OTA_REPOSITORY).insert(anOta({ name }));

  beforeAll(async () => {
    // AppConfigModule lee el entorno al importarse: AppModule se importa después de asignarlo.
    Object.assign(process.env, { NODE_ENV: 'test', ...integrationEnv() });
    const { AppModule } = await import('../../../src/app.module.js');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication<INestApplication<App>>({
      logger: false,
    });
    configureApp(app);
    await app.init();
    dataSource = app.get(DataSource);
    reservations = app.get<ReservationRepository>(RESERVATION_REPOSITORY);
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    if (dataSource !== undefined) {
      await truncateAllTables(dataSource);
    }
    await app?.close();
  });

  describe('escenario 1: búsqueda por reservationRef', () => {
    let stored: Reservation;

    beforeEach(async () => {
      // Dos habitaciones y 5 personas.
      stored = await reservations.insert(
        aDirectReservation({
          startDate: '2033-04-10',
          endDate: '2033-04-13',
          rooms: [
            aDirectRoom({ roomNumber: '201', guestCount: 2 }),
            aDirectRoom({ roomNumber: '305', guestCount: 3 }),
          ],
          guest: aGuest({ firstName: 'Valentina', lastName: 'Ospina' }),
        }),
      );
    });

    it('la búsqueda trae solo esa reserva, también escrita en minúsculas', async () => {
      const exact = await search(stored.reservationRef).expect(200);
      const lower = await search(stored.reservationRef.toLowerCase()).expect(
        200,
      );

      expect(refsOf(exact.body)).toEqual([stored.reservationRef]);
      expect(refsOf(lower.body)).toEqual([stored.reservationRef]);
    });

    it('el detalle trae status, fechas, noches, guestCount, las dos habitaciones con roomId, categoryRoom, guestCount y stayStatus, el titular y el canal', async () => {
      const res = await detail(stored.reservationRef).expect(200);

      expect(res.body).toMatchObject({
        reservationRef: stored.reservationRef,
        status: 'ACTIVE',
        source: 'DIRECT',
        externalConfirmationCode: null,
        otaName: null,
        startDate: '2033-04-10',
        endDate: '2033-04-13',
        nights: 3,
        guestCount: 5,
        cancellation: null,
        guest: { firstName: 'Valentina', lastName: 'Ospina' },
      });
      const rooms = res.body.rooms as Record<string, unknown>[];
      expect(
        rooms.map(({ roomNumber, guestCount }) => [roomNumber, guestCount]),
      ).toEqual([
        ['201', 2],
        ['305', 3],
      ]);
      for (const [index, room] of rooms.entries()) {
        expect(room).toMatchObject({
          roomId: stored.rooms[index].roomId,
          categoryRoom: 'DOBLE',
          stayStatus: 'EXPECTED',
        });
      }
    });
  });

  it('escenario 2: por el código de la OTA BK-99812, la búsqueda y el detalle traen esa reserva con su agencia', async () => {
    const agency = await anAgency('Booking.com');
    const stored = await reservations.insert(
      anOtaReservation(agency.id, {
        ota: otaTerms(agency.id, { externalConfirmationCode: 'BK-99812' }),
      }),
    );
    // Otra reserva de la agencia, que no debe salir.
    await reservations.insert(
      anOtaReservation(agency.id, {
        ota: otaTerms(agency.id, { externalConfirmationCode: 'BK-99813' }),
      }),
    );

    const found = await search('BK-99812').expect(200);
    const res = await detail(stored.reservationRef).expect(200);

    expect(refsOf(found.body)).toEqual([stored.reservationRef]);
    expect(found.body.items[0]).toMatchObject({
      externalConfirmationCode: 'BK-99812',
      otaName: 'Booking.com',
      source: 'OTA',
    });
    expect(res.body).toMatchObject({
      source: 'OTA',
      externalConfirmationCode: 'BK-99812',
      otaName: 'Booking.com',
    });
  });

  it('escenario 3: el código ignora los demás filtros: una CANCELLED aparece aunque se filtre por ACTIVE, canal y fechas', async () => {
    const cancelled = await reservations.insert(
      aDirectReservation({
        status: 'CANCELLED',
        statusReason: 'CANCELLED_BY_RECEPTION',
        startDate: '2033-04-10',
        endDate: '2033-04-12',
      }),
    );

    const res = await search(cancelled.reservationRef, {
      status: 'ACTIVE',
      source: 'OTA',
      dateFrom: '2034-01-01',
      dateTo: '2034-01-31',
    }).expect(200);

    expect(refsOf(res.body)).toEqual([cancelled.reservationRef]);
    expect(res.body.items[0].status).toBe('CANCELLED');
  });

  it('escenario 4: el detalle de una cancelada por la Recepcionista trae la fecha, el canal, el motivo y quién la procesó', async () => {
    const cancelled = await reservations.insert(
      aDirectReservation({
        status: 'CANCELLED',
        statusReason: 'CANCELLED_BY_RECEPTION',
      }),
    );
    await app.get<TransactionRunner>(TRANSACTION_RUNNER).run((tx) =>
      app.get<CancellationRepository>(CANCELLATION_REPOSITORY).insert(
        Cancellation.restore({
          id: randomUUID(),
          reservationRef: cancelled.reservationRef,
          cancellationDate: new Date('2033-04-01T14:30:00.000Z'),
          reason: 'El huésped cambió de planes',
          channel: 'RECEPTION',
          processedBy: 'Laura Gómez',
          status: 'COMPLETED',
        }),
        tx,
      ),
    );

    const res = await detail(cancelled.reservationRef).expect(200);

    expect(res.body.status).toBe('CANCELLED');
    expect(res.body.cancellation).toEqual({
      // En hora de Colombia, con segundos (C3).
      cancellationDate: '2033-04-01T09:30:00-05:00',
      channel: 'RECEPTION',
      reason: 'El huésped cambió de planes',
      processedBy: 'Laura Gómez',
    });
  });

  describe('escenario 5: un código inexistente', () => {
    it('con el formato RSV- y sin coincidencia: 400 "La reserva no existe.", en la búsqueda y en el detalle', async () => {
      await reservations.insert(aDirectReservation());

      const searched = await search('RSV-FFFFFFFF').expect(400);
      const opened = await detail('RSV-FFFFFFFF').expect(400);

      expect(searched.body).toMatchObject(NOT_FOUND);
      expect(opened.body).toMatchObject(NOT_FOUND);
    });

    it.each([
      ['con dígitos: se busca como documento', 'ZZ-12345'],
      ['sin dígitos: se busca como nombre', 'Gomez'],
    ])(
      'sin el formato RSV- y sin coincidencia, no es ese error: %s y responde 200 vacío',
      async (_, text) => {
        await reservations.insert(aDirectReservation());

        const res = await search(text).expect(200);

        expect(res.body).toMatchObject({ items: [], totalItems: 0 });
      },
    );

    it('un texto que coincide con un documento trae la reserva de ese titular', async () => {
      const stored = await reservations.insert(
        aDirectReservation({ guest: aGuest({ documentNumber: '1098765432' }) }),
      );

      const res = await search('1098765432').expect(200);

      expect(refsOf(res.body)).toEqual([stored.reservationRef]);
    });
  });

  describe('escenario 6: un código vacío, con solo espacios o con caracteres inválidos responde 400 sin consultar la base', () => {
    it.each([
      ['vacío', ''],
      ['solo espacios', '   '],
      ['con un espacio interno', 'RSV 3F9A1C7B'],
      ['con caracteres inválidos', 'RSV-3F9A$C7B'],
      ['con una comilla', "RSV-3F9A1C7B'"],
      ['de más de 40 caracteres', 'A'.repeat(41)],
    ])('en la búsqueda, %s', async (_, text) => {
      const listReservations = vi.spyOn(
        app.get<ReservationQueryPort>(RESERVATION_QUERY_PORT),
        'listReservations',
      );

      const res = await search(text).expect(400);

      expect(res.body).toEqual({
        ...INVALID_CODE,
        timestamp: expect.any(String) as string,
        path: LIST,
      });
      expect(listReservations).not.toHaveBeenCalled();
    });

    it.each([
      ['en minúsculas', 'rsv-3f9a1c7b'],
      ['corto', 'RSV-3F9A'],
      ['con caracteres inválidos', 'RSV-3F9A$C7B'],
    ])('en el detalle, un código %s', async (_, ref) => {
      const findByRef = vi.spyOn(reservations, 'findByRef');

      const res = await detail(ref).expect(400);

      expect(res.body).toMatchObject(INVALID_CODE);
      expect(findByRef).not.toHaveBeenCalled();
    });

    it('con un código válido, la consulta sí se ejecuta: el espía ve la llamada', async () => {
      const stored = await reservations.insert(aDirectReservation());
      const listReservations = vi.spyOn(
        app.get<ReservationQueryPort>(RESERVATION_QUERY_PORT),
        'listReservations',
      );
      const findByRef = vi.spyOn(reservations, 'findByRef');

      await search(stored.reservationRef).expect(200);
      await detail(stored.reservationRef).expect(200);

      expect(listReservations).toHaveBeenCalled();
      expect(findByRef).toHaveBeenCalled();
    });
  });
});
