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
import { configureApp } from '../../../src/configure-app.js';
import type {
  Reservation,
  ReservationProps,
} from '../../../src/domain/reservation/reservation.js';
import type { ReservationStatus } from '../../../src/domain/shared/enums.js';
import {
  aDirectReservation,
  aDirectRoom,
  aGuest,
  anOta,
  anOtaReservation,
  otaTerms,
} from '../../support/builders.js';
import { integrationEnv, truncateAllTables } from '../support/database.js';

/** Una fila del listado (C1). */
type Row = {
  reservationRef: string;
  externalConfirmationCode: string | null;
  source: string;
  otaName: string | null;
  startDate: string;
  endDate: string;
  status: string;
};

type Page = {
  items: Row[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  message: string | null;
};

/** `days` días después de `date` (`AAAA-MM-DD`). */
function plusDays(date: string, days: number): string {
  const moved = new Date(`${date}T00:00:00.000Z`);
  moved.setUTCDate(moved.getUTCDate() + days);
  return moved.toISOString().slice(0, 10);
}

/** Los estados del escenario 2, con el motivo que deja cada transición. */
const STATUS_REASONS: Partial<Record<ReservationStatus, string>> = {
  CANCELLED: 'CANCELLED_BY_RECEPTION',
};

/**
 * T013 de `check-view-reservation`: los escenarios 1 a 9 de la historia 1 del spec (el listado con
 * filtros, orden y paginación), con lo que pide cada fila de "Pruebas por escenario" del plan. Todo es
 * real: la aplicación completa (`AppModule`), la ruta `GET /api/reservations` con `X-Client:
 * RECEPTIONIST` y PostgreSQL. La base empieza vacía en cada prueba, así que los totales son exactos.
 */
describe('check-view-reservation: escenarios 1 a 9 de la historia 1, el listado (T013)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let reservations: ReservationRepository;
  let otas: OtaRepository;
  let codes = 0;

  const list = async (query: Record<string, string> = {}): Promise<Page> => {
    const res = await request(app.getHttpServer())
      .get('/api/reservations')
      .set('X-Client', 'RECEPTIONIST')
      .query(query)
      .expect(200);
    return res.body as Page;
  };

  /** Una reserva directa guardada; cada una con su habitación, para que no se crucen entre ellas. */
  const storeDirect = (
    changes: Partial<ReservationProps> = {},
  ): Promise<Reservation> =>
    reservations.insert(
      aDirectReservation({
        statusReason: STATUS_REASONS[changes.status ?? 'ACTIVE'] ?? null,
        ...changes,
      }),
    );

  /** Una reserva de la agencia `otaId` guardada, con su propio código de confirmación. */
  const storeOta = (
    otaId: string,
    changes: Partial<ReservationProps> = {},
  ): Promise<Reservation> => {
    codes += 1;
    return reservations.insert(
      anOtaReservation(otaId, {
        ota: otaTerms(otaId, {
          externalConfirmationCode: `BK-${99800 + codes}`,
        }),
        statusReason: STATUS_REASONS[changes.status ?? 'ACTIVE'] ?? null,
        ...changes,
      }),
    );
  };

  const refsOf = (page: Page) =>
    page.items.map(({ reservationRef }) => reservationRef);

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
    otas = app.get<OtaRepository>(OTA_REPOSITORY);
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    codes = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await truncateAllTables(dataSource);
    await app?.close();
  });

  it('escenario 1: con 45 reservas en distintos estados y sin filtros, la página 1 trae 10 por startDate descendente, con total 45 y 5 páginas, y cada fila con los datos de FR-005', async () => {
    const statuses: ReservationStatus[] = ['ACTIVE', 'PENDING', 'CANCELLED'];
    // 44 llegadas del 2026-10-02 al 2026-11-14, una por día, y la número 45 el 2026-11-15.
    for (let day = 1; day < 45; day++) {
      const startDate = plusDays('2026-10-01', day);
      await storeDirect({
        startDate,
        endDate: plusDays(startDate, 2),
        status: statuses[day % statuses.length],
      });
    }
    // La de la llegada más reciente es la primera fila: con los datos del ejemplo de C1.
    const latest = await reservations.insert(
      aDirectReservation({
        startDate: '2026-11-15',
        endDate: '2026-11-17',
        rooms: [aDirectRoom({ roomNumber: '204', categoryRoom: 'DOBLE' })],
        guest: aGuest({
          firstName: 'Valentina',
          lastName: 'Ospina',
          documentNumber: '1144093552',
        }),
      }),
    );

    const page = await list();

    expect(page).toMatchObject({
      page: 1,
      pageSize: 10,
      totalItems: 45,
      totalPages: 5,
      message: null,
    });
    expect(page.items).toHaveLength(10);
    expect(page.items.map(({ startDate }) => startDate)).toEqual(
      Array.from({ length: 10 }, (_, index) => plusDays('2026-11-15', -index)),
    );
    expect(page.items[0]).toEqual({
      reservationRef: latest.reservationRef,
      externalConfirmationCode: null,
      guest: { fullName: 'Valentina Ospina', documentNumber: '1144093552' },
      rooms: [{ roomNumber: '204', categoryRoom: 'DOBLE' }],
      source: 'DIRECT',
      otaName: null,
      startDate: '2026-11-15',
      endDate: '2026-11-17',
      status: 'ACTIVE',
      migrationStatus: 'AWAITING_CHECK_IN',
      conflict: null,
      actions: { canModify: true, canCancel: true, canAssignRoom: false },
    });
    // Hay más de un estado en la página: el listado sin filtros los trae todos.
    expect(
      new Set(page.items.map(({ status }) => status)).size,
    ).toBeGreaterThan(1);
  });

  it('escenario 2: con reservas ACTIVE, PENDING y CANCELLED, el filtro PENDING muestra únicamente las PENDING', async () => {
    await storeDirect({ status: 'ACTIVE' });
    const pending = [
      await storeDirect({ status: 'PENDING' }),
      await storeDirect({ status: 'PENDING' }),
    ];
    await storeDirect({ status: 'CANCELLED' });

    const page = await list({ status: 'PENDING' });

    expect(page.totalItems).toBe(2);
    expect(refsOf(page).sort()).toEqual(
      pending.map(({ reservationRef }) => reservationRef).sort(),
    );
    expect(page.items.every(({ status }) => status === 'PENDING')).toBe(true);
  });

  it('escenario 3: con reservas directas y de dos agencias, el filtro por canal OTA y una agencia muestra solo las de esa agencia, con su nombre y su código de confirmación en cada fila', async () => {
    const booking = await otas.insert(anOta({ name: 'Booking.com' }));
    const expedia = await otas.insert(anOta({ name: 'Expedia' }));
    await storeDirect();
    const ofBooking = [
      await storeOta(booking.id, {
        startDate: '2026-11-10',
        endDate: '2026-11-12',
      }),
      await storeOta(booking.id, {
        startDate: '2026-11-11',
        endDate: '2026-11-13',
      }),
    ];
    await storeOta(expedia.id);

    const page = await list({ source: 'OTA', otaId: booking.id });

    expect(page.totalItems).toBe(2);
    // De la llegada más reciente a la más antigua.
    expect(
      page.items.map(
        ({ reservationRef, source, otaName, externalConfirmationCode }) => ({
          reservationRef,
          source,
          otaName,
          externalConfirmationCode,
        }),
      ),
    ).toEqual(
      [...ofBooking].reverse().map((reservation) => ({
        reservationRef: reservation.reservationRef,
        source: 'OTA',
        otaName: 'Booking.com',
        externalConfirmationCode: reservation.ota?.externalConfirmationCode,
      })),
    );
    expect(page.items[0].externalConfirmationCode).toMatch(/^BK-\d+$/);
  });

  it('escenario 4: el filtro entre el 2026-10-02 y el 2026-10-06 muestra las dos reservas cuya estadía se cruza con el rango y excluye la tercera', async () => {
    const first = await storeDirect({
      startDate: '2026-09-28',
      endDate: '2026-10-03',
    });
    const second = await storeDirect({
      startDate: '2026-10-05',
      endDate: '2026-10-08',
    });
    await storeDirect({ startDate: '2026-10-10', endDate: '2026-10-12' });

    const page = await list({ dateFrom: '2026-10-02', dateTo: '2026-10-06' });

    expect(page.totalItems).toBe(2);
    expect(refsOf(page)).toEqual([second.reservationRef, first.reservationRef]);
  });

  it('escenario 4, los bordes del cruce: startDate igual a dateTo entra, y endDate igual a dateFrom no (ese día ya salió)', async () => {
    const arrivesOnLastDay = await storeDirect({
      startDate: '2026-10-06',
      endDate: '2026-10-09',
    });
    await storeDirect({ startDate: '2026-09-29', endDate: '2026-10-02' });

    const page = await list({ dateFrom: '2026-10-02', dateTo: '2026-10-06' });

    expect(refsOf(page)).toEqual([arrivesOnLastDay.reservationRef]);
  });

  it('escenario 5: con estado ACTIVE, canal DIRECT y un solo día (dateFrom y dateTo iguales al 2026-10-01), muestra solo las directas ACTIVE cuya estadía incluye ese día', async () => {
    const booking = await otas.insert(anOta());
    const includesTheDay = { startDate: '2026-09-30', endDate: '2026-10-02' };
    const expected = await storeDirect({ ...includesTheDay, status: 'ACTIVE' });
    await storeDirect({ ...includesTheDay, status: 'CANCELLED' });
    await storeOta(booking.id, { ...includesTheDay, status: 'ACTIVE' });
    await storeOta(booking.id, { ...includesTheDay, status: 'CANCELLED' });
    // Directa y ACTIVE, pero ese día ya salió (su salida es el 2026-10-01).
    await storeDirect({
      startDate: '2026-09-29',
      endDate: '2026-10-01',
      status: 'ACTIVE',
    });

    const page = await list({
      status: 'ACTIVE',
      source: 'DIRECT',
      dateFrom: '2026-10-01',
      dateTo: '2026-10-01',
    });

    expect(refsOf(page)).toEqual([expected.reservationRef]);
    expect(page.totalItems).toBe(1);
  });

  it('escenario 6: al cambiar el orden a ascendente, el listado va de la llegada más antigua a la más reciente sin alterar los filtros', async () => {
    const stored: Reservation[] = [];
    for (let day = 0; day < 12; day++) {
      const startDate = plusDays('2026-10-01', day);
      stored.push(
        await storeDirect({
          startDate,
          endDate: plusDays(startDate, 1),
          status: 'ACTIVE',
        }),
      );
    }
    // No cumple el filtro: no debe aparecer en ningún orden.
    await storeDirect({
      startDate: '2026-09-01',
      endDate: '2026-09-02',
      status: 'CANCELLED',
    });
    const refs = stored.map(({ reservationRef }) => reservationRef);

    const descending = await list({ status: 'ACTIVE' });
    const ascending = await list({ status: 'ACTIVE', order: 'asc' });

    expect(refsOf(descending)).toEqual([...refs].reverse().slice(0, 10));
    expect(refsOf(ascending)).toEqual(refs.slice(0, 10));
    expect(ascending).toMatchObject({ page: 1, totalItems: 12, totalPages: 2 });
    expect(ascending.items.every(({ status }) => status === 'ACTIVE')).toBe(
      true,
    );
  });

  it('escenario 7: con 25 reservas que cumplen los filtros, la página 3 trae las 5 últimas e informa 25 y 3 páginas, con los mismos filtros y el mismo orden', async () => {
    const stored: Reservation[] = [];
    for (let day = 0; day < 25; day++) {
      const startDate = plusDays('2026-10-01', day);
      stored.push(
        await storeDirect({
          startDate,
          endDate: plusDays(startDate, 1),
          status: 'ACTIVE',
        }),
      );
    }
    // Reservas que no cumplen el filtro: no cuentan en el total ni en las páginas.
    for (let day = 0; day < 3; day++) {
      await storeDirect({
        startDate: plusDays('2026-08-01', day),
        endDate: plusDays('2026-08-02', day),
        status: 'CANCELLED',
      });
    }

    const page = await list({ status: 'ACTIVE', page: '3' });

    expect(page).toMatchObject({
      page: 3,
      pageSize: 10,
      totalItems: 25,
      totalPages: 3,
    });
    // En orden descendente, las 5 últimas son las de las llegadas más antiguas.
    expect(refsOf(page)).toEqual(
      stored
        .slice(0, 5)
        .reverse()
        .map(({ reservationRef }) => reservationRef),
    );
  });

  it('escenario 8: si ninguna reserva cumple los filtros, responde 200 con la lista vacía, total 0 y el mensaje', async () => {
    await storeDirect({ status: 'ACTIVE' });

    const page = await list({ status: 'NO_SHOW' });

    expect(page).toEqual({
      items: [],
      page: 1,
      pageSize: 10,
      totalItems: 0,
      totalPages: 0,
      message: 'No se encontraron reservas con los filtros aplicados.',
    });
  });

  describe('escenario 9: un filtro inválido responde 400 con el mensaje de la tabla de C1 y no ejecuta la consulta', () => {
    const OTA_ID = '0b6f8a52-1c3d-4e5f-9a7b-1c2d3e4f5a6b';

    it.each([
      [
        'INVALID_RESERVATION_CODE',
        { search: '   ' },
        'Debe proveer un código de reserva válido para la consulta.',
      ],
      [
        'INVALID_STATUS',
        { status: 'CONFIRMED' },
        'El estado indicado no es válido.',
      ],
      [
        'INVALID_CHANNEL',
        { source: 'PHONE' },
        'El canal indicado no es válido.',
      ],
      [
        'INVALID_OTA_ID',
        { source: 'OTA', otaId: 'booking' },
        'La agencia indicada no es válida.',
      ],
      [
        'AGENCY_REQUIRES_OTA_CHANNEL',
        { otaId: OTA_ID },
        'La agencia solo aplica a reservas del canal OTA.',
      ],
      [
        'INVALID_CONFLICT_FILTER',
        { inConflict: 'false' },
        'El filtro de conflicto no es válido.',
      ],
      [
        'INVALID_DATE',
        { dateFrom: '2026-02-30', dateTo: '2026-03-05' },
        'La fecha indicada no es válida.',
      ],
      [
        'INVALID_DATE',
        { dateFrom: '01/10/2026', dateTo: '2026-10-05' },
        'La fecha indicada no es válida.',
      ],
      [
        'INCOMPLETE_DATE_RANGE',
        { dateFrom: '2026-10-01' },
        'Debe completar ambas fechas del rango.',
      ],
      [
        'INCOMPLETE_DATE_RANGE',
        { dateTo: '2026-10-01' },
        'Debe completar ambas fechas del rango.',
      ],
      [
        'INVALID_DATE_RANGE',
        { dateFrom: '2026-10-06', dateTo: '2026-10-02' },
        'La fecha inicial no puede ser posterior a la fecha final.',
      ],
      [
        'DATE_RANGE_TOO_LARGE',
        { dateFrom: '2026-01-01', dateTo: '2027-01-02' },
        'El rango de fechas no puede superar 366 días.',
      ],
      [
        'INVALID_SORT_ORDER',
        { order: 'newest' },
        'El orden indicado no es válido.',
      ],
      [
        'INVALID_PAGE',
        { page: '0' },
        'El número de página debe ser 1 o mayor.',
      ],
      [
        'INVALID_PAGE',
        { page: '1.5' },
        'El número de página debe ser 1 o mayor.',
      ],
    ])('%s con %j', async (errorCode, query, message) => {
      const listReservations = vi.spyOn(
        app.get<ReservationQueryPort>(RESERVATION_QUERY_PORT),
        'listReservations',
      );

      const res = await request(app.getHttpServer())
        .get('/api/reservations')
        .set('X-Client', 'RECEPTIONIST')
        .query(query)
        .expect(400);

      expect(res.body).toEqual({
        errorCode,
        message,
        timestamp: expect.any(String) as string,
        path: '/api/reservations',
      });
      expect(listReservations).not.toHaveBeenCalled();
    });

    it('con un filtro válido la consulta sí se ejecuta: el espía ve la llamada', async () => {
      const listReservations = vi.spyOn(
        app.get<ReservationQueryPort>(RESERVATION_QUERY_PORT),
        'listReservations',
      );

      await list({ status: 'ACTIVE' });

      expect(listReservations).toHaveBeenCalledOnce();
    });
  });
});
