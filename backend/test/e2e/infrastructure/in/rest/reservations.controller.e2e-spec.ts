import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  RESERVATION_REPOSITORY,
  type ReservationRepository,
} from '../../../../../src/application/ports/out/reservation.repository.js';
import { AppModule } from '../../../../../src/app.module.js';
import { configureApp } from '../../../../../src/configure-app.js';
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
