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
  RESERVATION_QUERY_PORT,
  type ReservationQueryPort,
} from '../../../src/application/ports/out/reservation-query.port.js';
import {
  RESERVATION_REPOSITORY,
  type ReservationRepository,
} from '../../../src/application/ports/out/reservation.repository.js';
import { configureApp } from '../../../src/configure-app.js';
import type {
  Reservation,
  ReservationProps,
} from '../../../src/domain/reservation/reservation.js';
import type { GuestProps } from '../../../src/domain/guest/guest.js';
import { aDirectReservation, aGuest } from '../../support/builders.js';
import { integrationEnv, truncateAllTables } from '../support/database.js';

const LIST = '/api/reservations';

/** El huésped de los escenarios 1 y 3: cada reserva guarda su propio titular, con los mismos datos. */
const HOLDER: Partial<GuestProps> = {
  firstName: 'María José',
  lastName: 'Gómez',
  documentNumber: '1098765432',
};

/** El motivo que deja cada transición, para que la reserva sea válida en ese estado. */
const STATUS_REASONS: Record<string, string | null> = {
  ACTIVE: null,
  COMPLETED: null,
  CANCELLED: 'CANCELLED_BY_RECEPTION',
};

type Row = { reservationRef: string; status: string };

/**
 * T022 de `check-view-reservation`: los escenarios 1 a 4 de la historia 3 del spec (la búsqueda por titular),
 * con lo que pide su fila en "Pruebas por escenario" del plan: documento (tres reservas), nombre parcial
 * `gomez`, documento más estado, y nombre de menos de 3 caracteres. Todo es real: la aplicación completa,
 * `GET /api/reservations?search=` (C1) con `X-Client: RECEPTIONIST` y PostgreSQL, con
 * `immutable_unaccent` y `pg_trgm`. La base empieza vacía en cada prueba.
 */
describe('check-view-reservation: escenarios 1 a 4 de la historia 3, la búsqueda por titular (T022)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let reservations: ReservationRepository;
  /** Las tres reservas del huésped, por estado. */
  let byStatus: Record<'ACTIVE' | 'COMPLETED' | 'CANCELLED', Reservation>;
  /** Una reserva de otra persona, que nunca debe salir. */
  let other: Reservation;

  const search = (text: string, query: Record<string, string> = {}) =>
    request(app.getHttpServer())
      .get(LIST)
      .set('X-Client', 'RECEPTIONIST')
      .query({ search: text, ...query });

  const rowsOf = (body: { items: Row[] }) =>
    body.items
      .map(({ reservationRef, status }) => ({ reservationRef, status }))
      .sort((a, b) => a.reservationRef.localeCompare(b.reservationRef));

  const store = (
    status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED',
    guest: Partial<GuestProps>,
    changes: Partial<ReservationProps> = {},
  ) =>
    reservations.insert(
      aDirectReservation({
        status,
        statusReason: STATUS_REASONS[status],
        guest: aGuest(guest),
        ...changes,
      }),
    );

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
    byStatus = {
      COMPLETED: await store('COMPLETED', HOLDER, {
        startDate: '2033-01-10',
        endDate: '2033-01-12',
      }),
      ACTIVE: await store('ACTIVE', HOLDER, {
        startDate: '2033-06-10',
        endDate: '2033-06-12',
      }),
      CANCELLED: await store('CANCELLED', HOLDER, {
        startDate: '2033-03-10',
        endDate: '2033-03-12',
      }),
    };
    other = await store('ACTIVE', {
      firstName: 'Andrés',
      lastName: 'Restrepo',
      documentNumber: '1098765433',
    });
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

  it('escenario 1: por su documento, las tres reservas del huésped con su status, y ninguna de otra persona', async () => {
    const res = await search('1098765432').expect(200);

    expect(rowsOf(res.body)).toEqual(
      rowsOf({
        items: [
          {
            reservationRef: byStatus.COMPLETED.reservationRef,
            status: 'COMPLETED',
          },
          { reservationRef: byStatus.ACTIVE.reservationRef, status: 'ACTIVE' },
          {
            reservationRef: byStatus.CANCELLED.reservationRef,
            status: 'CANCELLED',
          },
        ],
      }),
    );
    expect(res.body.totalItems).toBe(3);
  });

  it('escenario 1: el documento es exacto: una parte del número no trae nada', async () => {
    const res = await search('109876543').expect(200);

    expect(res.body).toMatchObject({ items: [], totalItems: 0 });
  });

  it.each([
    ['en minúsculas y sin tilde', 'gomez'],
    ['con la tilde', 'Gómez'],
    ['en mayúsculas', 'GOMEZ'],
    ['parte del nombre', 'josé'],
  ])(
    'escenario 2: por el nombre parcial %s ("%s"), las reservas de María José Gómez',
    async (_, text) => {
      const res = await search(text).expect(200);

      const refs = rowsOf(res.body).map(({ reservationRef }) => reservationRef);
      expect(refs).toEqual(
        [
          byStatus.COMPLETED.reservationRef,
          byStatus.ACTIVE.reservationRef,
          byStatus.CANCELLED.reservationRef,
        ].sort(),
      );
      expect(refs).not.toContain(other.reservationRef);
    },
  );

  it('escenario 3: el documento combinado con el estado ACTIVE trae solo la reserva ACTIVE', async () => {
    const res = await search('1098765432', { status: 'ACTIVE' }).expect(200);

    expect(rowsOf(res.body)).toEqual([
      { reservationRef: byStatus.ACTIVE.reservationRef, status: 'ACTIVE' },
    ]);
  });

  it('escenario 3: el nombre también se combina con los filtros (estado y fechas)', async () => {
    const res = await search('gomez', {
      status: 'COMPLETED',
      dateFrom: '2033-01-01',
      dateTo: '2033-01-31',
    }).expect(200);

    expect(rowsOf(res.body)).toEqual([
      {
        reservationRef: byStatus.COMPLETED.reservationRef,
        status: 'COMPLETED',
      },
    ]);
  });

  describe('escenario 4: un nombre de menos de 3 caracteres', () => {
    it.each([
      ['dos letras', 'go'],
      ['una letra', 'g'],
      ['dos letras con espacios alrededor', '  go  '],
    ])(
      'con %s: 400 con el mensaje literal, sin consultar la base',
      async (_, text) => {
        const listReservations = vi.spyOn(
          app.get<ReservationQueryPort>(RESERVATION_QUERY_PORT),
          'listReservations',
        );

        const res = await search(text).expect(400);

        expect(res.body).toEqual({
          errorCode: 'NAME_SEARCH_TOO_SHORT',
          message: 'La búsqueda por nombre requiere al menos 3 caracteres.',
          timestamp: expect.any(String) as string,
          path: LIST,
        });
        expect(listReservations).not.toHaveBeenCalled();
      },
    );

    it('con exactamente 3 letras sí busca', async () => {
      const res = await search('gom').expect(200);

      expect(res.body.totalItems).toBe(3);
    });

    it('un texto corto con un dígito no es un nombre: se busca como documento', async () => {
      const res = await search('g1').expect(200);

      expect(res.body).toMatchObject({ items: [], totalItems: 0 });
    });
  });
});
