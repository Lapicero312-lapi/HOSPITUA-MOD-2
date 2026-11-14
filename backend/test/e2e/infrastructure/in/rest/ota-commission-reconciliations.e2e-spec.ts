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
  anOta,
  anOtaReservation,
  otaTerms,
} from '../../../../support/builders.js';

const ROUTE = '/api/ota-commissions/reconciliations';

/**
 * La aplicación completa (`AppModule`) con la base de Testcontainers: comprueba que
 * `POST /api/ota-commissions/reconciliations` (A2 de `register-ota-information-commission`) está conectada
 * con `ReconcileCommissions`, con `readReconciliationRequest`, `RECONCILIATION_MAX_ITEMS` (500 por defecto)
 * y el filtro global (T012).
 */
describe('POST /api/ota-commissions/reconciliations (e2e, A2)', () => {
  let app: INestApplication<App>;
  let completed: Reservation;

  const post = (body: unknown) =>
    request(app.getHttpServer())
      .post(ROUTE)
      .send(body as object);

  const item = (reservationRef: string) => ({
    reservationRef,
    grossAmount: '400.00',
    commissionAmount: '60.00',
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    // La base de las e2e es compartida: una agencia propia, para no chocar con el nombre único.
    const agency = await app
      .get<OtaRepository>(OTA_REPOSITORY)
      .insert(anOta({ name: `Agencia conciliación e2e ${randomUUID()}` }));
    completed = await app
      .get<ReservationRepository>(RESERVATION_REPOSITORY)
      .insert(
        anOtaReservation(agency.id, {
          status: 'COMPLETED',
          ota: otaTerms(agency.id, {
            externalConfirmationCode: randomUUID().slice(0, 20),
            grossAmount: Money.of('400', 'USD'),
            commissionPercentage: '15',
            commissionAmount: Money.of('60', 'USD'),
          }),
        }),
      );
  });

  afterAll(async () => {
    await app.close();
  });

  it('200 con la forma de A2: el resultado de cada ítem y el resumen', async () => {
    const res = await post({
      action: 'RECONCILED',
      items: [item(completed.reservationRef), item('RSV-FFFFFFFF')],
    }).expect(200);

    expect(res.body).toEqual({
      action: 'RECONCILED',
      results: [
        {
          reservationRef: completed.reservationRef,
          result: 'APPLIED',
          commissionStatus: 'RECONCILED',
          reason: null,
        },
        {
          reservationRef: 'RSV-FFFFFFFF',
          result: 'REJECTED',
          commissionStatus: null,
          reason: 'RESERVATION_NOT_FOUND',
        },
      ],
      summary: { applied: 1, alreadyApplied: 0, rejected: 1 },
    });
  });

  it('con 500 ítems (el máximo por defecto) se procesa; con 501, 400 INVALID_RECONCILIATION_REQUEST', async () => {
    const items = (count: number) =>
      Array.from({ length: count }, () => item('RSV-FFFFFFFE'));

    const ok = await post({ action: 'PAID', items: items(500) }).expect(200);
    expect(ok.body.summary).toEqual({
      applied: 0,
      alreadyApplied: 0,
      rejected: 500,
    });
    const tooMany = await post({ action: 'PAID', items: items(501) }).expect(
      400,
    );
    expect(tooMany.body.errorCode).toBe('INVALID_RECONCILIATION_REQUEST');
  }, 60_000);

  it.each([
    ['INVALID_RECONCILIATION_REQUEST', { action: 'PAID', items: [] }],
    [
      'INVALID_RECONCILIATION_ACTION',
      { action: 'BORRAR', items: [item('RSV-8D02E5A4')] },
    ],
    ['INVALID_RESERVATION_CODE', { action: 'PAID', items: [item('rsv-1')] }],
    [
      'INVALID_AMOUNT',
      {
        action: 'PAID',
        items: [{ ...item('RSV-8D02E5A4'), commissionAmount: '-60.00' }],
      },
    ],
  ])(
    '400 %s por el filtro global, con su mensaje literal y la forma de los errores',
    async (errorCode, body) => {
      const messages: Record<string, string> = {
        INVALID_RECONCILIATION_REQUEST:
          'La solicitud de conciliación no es válida.',
        INVALID_RECONCILIATION_ACTION:
          'La acción de conciliación no es válida.',
        INVALID_RESERVATION_CODE:
          'Debe proveer un código de reserva válido para la consulta.',
        INVALID_AMOUNT: 'El importe no es válido.',
      };

      const res = await post(body).expect(400);

      expect(res.body).toEqual({
        errorCode,
        message: messages[errorCode],
        timestamp: expect.any(String) as string,
        path: ROUTE,
      });
    },
  );
});
