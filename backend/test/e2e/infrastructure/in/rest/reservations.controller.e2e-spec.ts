import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CLOCK } from '../../../../../src/application/ports/out/clock.js';
import {
  RESERVATION_REPOSITORY,
  type ReservationRepository,
} from '../../../../../src/application/ports/out/reservation.repository.js';
import { AppModule } from '../../../../../src/app.module.js';
import { configureApp } from '../../../../../src/configure-app.js';
import { CloseDayJob } from '../../../../../src/infrastructure/in/jobs/close-day.job.js';
import {
  aDirectReservation,
  aDirectRoom,
  aGuest,
} from '../../../../support/builders.js';

/**
 * Fechas propias de esta prueba: la base de las e2e es compartida, así que cada consulta se acota a este
 * rango para no depender de lo que guarden otras.
 */
const RANGE = { dateFrom: '2031-03-01', dateTo: '2031-03-31' };

/**
 * La aplicación completa (`AppModule`) con la base de Testcontainers: comprueba que `GET /api/reservations`
 * está conectada con `ListReservations`, con la lectura de `X-Client` y el DTO de los filtros, y que sus
 * errores salen por el filtro global. Los escenarios de la historia 1 los prueba T013.
 */
describe('GET /api/reservations (e2e)', () => {
  let app: INestApplication<App>;

  const list = (query: Record<string, string>, client = 'RECEPTIONIST') =>
    request(app.getHttpServer())
      .get('/api/reservations')
      .set('X-Client', client)
      .query({ ...RANGE, ...query });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    const reservations = app.get<ReservationRepository>(RESERVATION_REPOSITORY);
    // 12 reservas del 1 al 12 de marzo de 2031; la del día 1 es la del ejemplo de C1.
    for (let day = 1; day <= 12; day++) {
      const start = `2031-03-${String(day).padStart(2, '0')}`;
      const end = `2031-03-${String(day + 2).padStart(2, '0')}`;
      await reservations.insert(
        aDirectReservation({
          startDate: start,
          endDate: end,
          status: 'ACTIVE',
          rooms: [aDirectRoom({ roomNumber: '204', categoryRoom: 'DOBLE' })],
          guest: aGuest({
            firstName: 'Valentina',
            lastName: 'Ospina',
            documentNumber: `E2E-LIST-${day}`,
          }),
        }),
      );
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('responde 200 con la página 1 de 10, de la llegada más reciente a la más antigua, y la fila de C1', async () => {
    const res = await list({}).expect(200);

    expect(res.body).toMatchObject({
      page: 1,
      pageSize: 10,
      totalItems: 12,
      totalPages: 2,
      message: null,
    });
    expect(res.body.items).toHaveLength(10);
    expect(res.body.items[0]).toEqual({
      reservationRef: expect.stringMatching(/^RSV-[0-9A-F]{8}$/),
      externalConfirmationCode: null,
      guest: { fullName: 'Valentina Ospina', documentNumber: 'E2E-LIST-12' },
      rooms: [{ roomNumber: '204', categoryRoom: 'DOBLE' }],
      source: 'DIRECT',
      otaName: null,
      startDate: '2031-03-12',
      endDate: '2031-03-14',
      status: 'ACTIVE',
      migrationStatus: 'AWAITING_CHECK_IN',
      conflict: null,
      actions: { canModify: true, canCancel: true, canAssignRoom: false },
    });
  });

  it('una página que pasa de la última devuelve la última válida', async () => {
    const res = await list({ page: '9' }).expect(200);

    expect(res.body).toMatchObject({ page: 2, totalPages: 2, totalItems: 12 });
    expect(res.body.items).toHaveLength(2);
  });

  it('sin resultados: 200, items vacío y el mensaje', async () => {
    const res = await list({ status: 'CANCELLED' }).expect(200);

    expect(res.body).toEqual({
      items: [],
      page: 1,
      pageSize: 10,
      totalItems: 0,
      totalPages: 0,
      message: 'No se encontraron reservas con los filtros aplicados.',
    });
  });

  it('un filtro inválido responde 400 con su código y su mensaje, por el filtro global', async () => {
    const res = await list({ status: 'X' }).expect(400);

    expect(res.body).toMatchObject({
      errorCode: 'INVALID_STATUS',
      message: 'El estado indicado no es válido.',
      path: '/api/reservations',
    });
  });

  describe('con search (T015, T020 y T021)', () => {
    it('por código: la referencia encuentra su reserva aunque los demás filtros no la incluyan', async () => {
      const first = await list({ sort: 'asc' }).expect(200);
      const ref: string = first.body.items[0].reservationRef;

      const res = await list({
        search: ref.toLowerCase(),
        dateFrom: '2001-01-01',
        dateTo: '2001-01-02',
        status: 'CANCELLED',
      }).expect(200);

      expect(
        res.body.items.map(
          (row: { reservationRef: string }) => row.reservationRef,
        ),
      ).toEqual([ref]);
    });

    it('por documento exacto, combinado con las fechas', async () => {
      const res = await list({ search: 'E2E-LIST-3' }).expect(200);

      expect(res.body.totalItems).toBe(1);
      expect(res.body.items[0].guest.documentNumber).toBe('E2E-LIST-3');
    });

    it('por nombre parcial, sin mayúsculas, combinado con las fechas', async () => {
      const res = await list({ search: 'OSPI' }).expect(200);

      expect(res.body).toMatchObject({ totalItems: 12, totalPages: 2 });
    });

    it('una referencia RSV- que no existe responde 400 RESERVATION_NOT_FOUND', async () => {
      const res = await list({ search: 'RSV-FFFFFFFF' }).expect(400);

      expect(res.body.errorCode).toBe('RESERVATION_NOT_FOUND');
    });

    it('un nombre de menos de 3 caracteres responde 400 NAME_SEARCH_TOO_SHORT', async () => {
      const res = await list({ search: 'Os' }).expect(400);

      expect(res.body).toMatchObject({
        errorCode: 'NAME_SEARCH_TOO_SHORT',
        message: 'La búsqueda por nombre requiere al menos 3 caracteres.',
      });
    });
  });

  describe('con X-Client: MODULE1, la consulta por fechas (C5, T033)', () => {
    it('responde 200 con todas las reservas del rango, sin paginar, de la llegada más antigua a la más reciente y con la forma de C5', async () => {
      const res = await list({}, 'MODULE1').expect(200);

      const body = res.body as { items: Record<string, unknown>[] };
      expect(Object.keys(body)).toEqual(['items']);
      // Las 12 de marzo de 2031: no hay página de 10.
      expect(body.items).toHaveLength(12);
      expect(body.items.map(({ startDate }) => startDate)).toEqual(
        Array.from(
          { length: 12 },
          (_, index) => `2031-03-${String(index + 1).padStart(2, '0')}`,
        ),
      );
      expect(body.items[0]).toEqual({
        reservationRef: expect.stringMatching(/^RSV-[0-9A-F]{8}$/) as string,
        status: 'ACTIVE',
        startDate: '2031-03-01',
        endDate: '2031-03-03',
        rooms: [
          {
            roomId: expect.stringMatching(/^[0-9a-f-]{36}$/) as string,
            roomNumber: '204',
            categoryRoom: 'DOBLE',
          },
        ],
      });
    });

    it('con roomId devuelve solo la reserva de esa habitación', async () => {
      const all = await list({}, 'MODULE1').expect(200);
      const [first] = (
        all.body as {
          items: { reservationRef: string; rooms: { roomId: string }[] }[];
        }
      ).items;

      const res = await list(
        { roomId: first.rooms[0].roomId },
        'MODULE1',
      ).expect(200);

      expect(
        (res.body as { items: { reservationRef: string }[] }).items.map(
          ({ reservationRef }) => reservationRef,
        ),
      ).toEqual([first.reservationRef]);
    });

    it('un parámetro de la Recepcionista responde 400 UNSUPPORTED_PARAMETER con su nombre', async () => {
      const res = await list({ status: 'ACTIVE' }, 'MODULE1').expect(400);

      expect(res.body).toMatchObject({
        errorCode: 'UNSUPPORTED_PARAMETER',
        message: 'El parámetro status no se admite en esta consulta.',
        path: '/api/reservations',
      });
    });

    it('sin las fechas responde 400 INCOMPLETE_DATE_RANGE: para el Módulo 1 son obligatorias', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/reservations')
        .set('X-Client', 'MODULE1')
        .expect(400);

      expect(res.body).toMatchObject({
        errorCode: 'INCOMPLETE_DATE_RANGE',
        message: 'Debe completar ambas fechas del rango.',
      });
    });
  });

  it.each([
    ['sin X-Client', undefined],
    ['con un X-Client que la ruta todavía no admite', 'MODULE3'],
  ])('%s: 400 INVALID_CLIENT', async (_, client) => {
    const req = request(app.getHttpServer())
      .get('/api/reservations')
      .query(RANGE);
    const res = await (
      client === undefined ? req : req.set('X-Client', client)
    ).expect(400);

    expect(res.body).toMatchObject({
      errorCode: 'INVALID_CLIENT',
      message: 'La ruta no admite el cliente indicado en X-Client.',
    });
  });
});

/** Día operativo propio de esta prueba: la base de las e2e es compartida y C2 cuenta todo lo del día. */
const SUMMARY_DAY = '2032-06-15';

/**
 * La aplicación completa con el reloj en `SUMMARY_DAY`: comprueba que `GET /api/reservations/day-summary`
 * está conectada con `GetDaySummary`, con la base y con la lectura de `X-Client` (C2, T012). Qué estados y
 * fechas cuentan lo prueba `reservation-day-summary.query.spec.ts`.
 */
describe('GET /api/reservations/day-summary (e2e)', () => {
  let app: INestApplication<App>;

  const summary = () =>
    request(app.getHttpServer()).get('/api/reservations/day-summary');

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(CLOCK)
      .useValue({
        today: () => SUMMARY_DAY,
        now: () => new Date(`${SUMMARY_DAY}T15:00:00Z`),
      })
      // Con el reloj fijo, el cierre del día no corre al arrancar: en la base compartida cerraría las
      // reservas que otras e2e guardaron antes de ese día (recuperación de T022 de update-reservation).
      .overrideProvider(CloseDayJob)
      .useValue({})
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    const reservations = app.get<ReservationRepository>(RESERVATION_REPOSITORY);
    await reservations.insert(
      aDirectReservation({
        status: 'ACTIVE',
        startDate: SUMMARY_DAY,
        endDate: '2032-06-17',
      }),
    );
    await reservations.insert(
      aDirectReservation({
        status: 'PENDING',
        startDate: SUMMARY_DAY,
        endDate: '2032-06-17',
      }),
    );
    await reservations.insert(
      aDirectReservation({
        status: 'IN_PROGRESS',
        startDate: '2032-06-13',
        endDate: SUMMARY_DAY,
      }),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('responde 200 con la forma exacta de C2 y las cifras del día operativo', async () => {
    const res = await summary().set('X-Client', 'RECEPTIONIST').expect(200);

    expect(res.body).toEqual({
      operationalDate: SUMMARY_DAY,
      expectedArrivals: 2,
      expectedDepartures: 1,
    });
  });

  it.each([
    ['sin X-Client', undefined],
    ['con MODULE1', 'MODULE1'],
    ['con MODULE3', 'MODULE3'],
    ['con OTA', 'OTA'],
  ])('%s: 400 INVALID_CLIENT', async (_, client) => {
    const res = await (
      client === undefined ? summary() : summary().set('X-Client', client)
    ).expect(400);

    expect(res.body).toMatchObject({
      errorCode: 'INVALID_CLIENT',
      message: 'La ruta no admite el cliente indicado en X-Client.',
      path: '/api/reservations/day-summary',
    });
  });
});
