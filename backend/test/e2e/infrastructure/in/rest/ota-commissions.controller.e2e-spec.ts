import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  OTA_REPOSITORY,
  type OtaRepository,
} from '../../../../../src/application/ports/out/ota.repository.js';
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
  anOta,
  anOtaReservation,
  otaTerms,
} from '../../../../support/builders.js';

/** Un periodo que no usa ninguna otra prueba: la base de las e2e es compartida. */
const FROM = '2037-03-01';
const TO = '2037-03-31';
const ROUTE = '/api/ota-commissions';

/**
 * La aplicación completa (`AppModule`) con la base de Testcontainers: comprueba que
 * `GET /api/ota-commissions` (A1 de `register-ota-information-commission`) está conectada con
 * `ListOtaCommissions`, con `readOtaCommissionQuery` y el DTO de A1, y que sus errores salen por el filtro
 * global (T011).
 */
describe('GET /api/ota-commissions (e2e, A1)', () => {
  let app: INestApplication<App>;
  let otaId: string;
  let agencyName: string;
  let completed: Reservation;
  let active: Reservation;

  const list = (query: Record<string, string>) =>
    request(app.getHttpServer()).get(ROUTE).query(query);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    const reservations = app.get<ReservationRepository>(RESERVATION_REPOSITORY);
    // Una agencia propia, para no chocar con el nombre único ni con las reservas de otras pruebas.
    agencyName = `Agencia comisiones e2e ${randomUUID()}`;
    const agency = await app
      .get<OtaRepository>(OTA_REPOSITORY)
      .insert(anOta({ name: agencyName }));
    otaId = agency.id;
    completed = await reservations.insert(
      anOtaReservation(otaId, {
        status: 'COMPLETED',
        startDate: '2037-03-10',
        endDate: '2037-03-12',
        ota: otaTerms(otaId, {
          externalConfirmationCode: '4417829013',
          grossAmount: Money.of('400', 'USD'),
          commissionPercentage: '15',
          commissionAmount: Money.of('60', 'USD'),
        }),
      }),
    );
    active = await reservations.insert(
      anOtaReservation(otaId, {
        status: 'ACTIVE',
        startDate: '2037-03-20',
        endDate: '2037-03-22',
        ota: otaTerms(otaId, { externalConfirmationCode: '4417829014' }),
      }),
    );
    // Una directa en el mismo periodo: no sale.
    await reservations.insert(
      aDirectReservation({ startDate: '2037-03-10', endDate: '2037-03-12' }),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('200 con la forma de A1: importes como texto, el porcentaje como número y la paginación', async () => {
    const res = await list({ dateFrom: FROM, dateTo: TO, otaId }).expect(200);

    expect(res.body).toEqual({
      items: [
        {
          reservationRef: completed.reservationRef,
          otaId,
          otaName: agencyName,
          externalConfirmationCode: '4417829013',
          status: 'COMPLETED',
          startDate: '2037-03-10',
          endDate: '2037-03-12',
          grossAmount: { amount: '400.00', currency: 'USD' },
          commissionPercentage: 15,
          commissionAmount: { amount: '60.00', currency: 'USD' },
          commissionStatus: 'CALCULATED',
        },
        expect.objectContaining({ reservationRef: active.reservationRef }),
      ],
      page: 1,
      pageSize: 100,
      totalItems: 2,
      totalPages: 1,
    });
  });

  it('los filtros llegan a la consulta: reservationStatus y commissionStatus', async () => {
    const byStatus = await list({
      dateFrom: FROM,
      dateTo: TO,
      otaId,
      reservationStatus: 'COMPLETED',
    }).expect(200);
    const byCommission = await list({
      dateFrom: FROM,
      dateTo: TO,
      otaId,
      commissionStatus: 'PAID',
    }).expect(200);

    expect(
      (byStatus.body as { items: { reservationRef: string }[] }).items.map(
        (item) => item.reservationRef,
      ),
    ).toEqual([completed.reservationRef]);
    expect(byCommission.body).toMatchObject({ items: [], totalItems: 0 });
  });

  it('una página que pasa de la última devuelve la última válida', async () => {
    const res = await list({
      dateFrom: FROM,
      dateTo: TO,
      otaId,
      page: '9',
    }).expect(200);

    expect(res.body).toMatchObject({ page: 1, totalItems: 2, totalPages: 1 });
  });

  it('una agencia que no existe: 200 con items vacío', async () => {
    const res = await list({
      dateFrom: FROM,
      dateTo: TO,
      otaId: randomUUID(),
    }).expect(200);

    expect(res.body).toMatchObject({ items: [], page: 1, totalItems: 0 });
  });

  it.each([
    ['INCOMPLETE_DATE_RANGE', { dateFrom: FROM }],
    ['INVALID_DATE', { dateFrom: '2037-02-30', dateTo: TO }],
    ['INVALID_DATE_RANGE', { dateFrom: TO, dateTo: FROM }],
    ['DATE_RANGE_TOO_LARGE', { dateFrom: '2037-01-01', dateTo: '2038-01-03' }],
    [
      'INVALID_COMMISSION_STATUS',
      { dateFrom: FROM, dateTo: TO, commissionStatus: 'PENDING' },
    ],
    [
      'INVALID_STATUS',
      { dateFrom: FROM, dateTo: TO, reservationStatus: 'BORRADA' },
    ],
    ['OTA_NOT_FOUND', { dateFrom: FROM, dateTo: TO, otaId: 'abc' }],
    ['INVALID_PAGE', { dateFrom: FROM, dateTo: TO, page: '0' }],
  ])(
    '400 %s por el filtro global, con la forma de los errores',
    async (errorCode, query) => {
      const res = await list(query).expect(400);

      expect(res.body).toEqual({
        errorCode,
        message: expect.any(String) as string,
        timestamp: expect.any(String) as string,
        path: expect.stringContaining(ROUTE) as string,
      });
    },
  );
});
