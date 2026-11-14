import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { setupServer } from 'msw/node';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CLOCK, type Clock } from '../../../src/application/ports/out/clock.js';
import {
  OTA_REPOSITORY,
  type OtaRepository,
} from '../../../src/application/ports/out/ota.repository.js';
import {
  RESERVATION_REPOSITORY,
  type ReservationRepository,
} from '../../../src/application/ports/out/reservation.repository.js';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../src/application/ports/out/transaction.js';
import {
  CANCEL_RESERVATION,
  type CancelReservation,
} from '../../../src/application/use-cases/cancel-reservation/ports/in/cancel-reservation.port.js';
import { configureApp } from '../../../src/configure-app.js';
import type { Reservation } from '../../../src/domain/reservation/reservation.js';
import type {
  CommissionStatus,
  ReservationStatus,
} from '../../../src/domain/shared/enums.js';
import { Money } from '../../../src/domain/shared/money.js';
import { anOta, anOtaReservation, otaTerms } from '../../support/builders.js';
import { integrationEnv, truncateAllTables } from '../support/database.js';

/** El día operativo: las reservas de la prueba salieron antes, en 2036. */
const clock: Clock = {
  today: () => '2036-06-01',
  now: () => new Date('2036-06-01T15:00:00.000Z'),
};

const ROUTE = '/api/ota-commissions/reconciliations';

const server = setupServer();

/**
 * T014 de `register-ota-information-commission`: los escenarios 1 a 3 de la historia 2 y los casos de A2
 * que dependen de la base (conciliación repetida y dos actualizaciones de la misma reserva), con la
 * aplicación completa, PostgreSQL real y `POST /api/ota-commissions/reconciliations`.
 */
describe('Conciliación de comisiones del Módulo 3 (historia 2, T012 a T014)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let otaId: string;

  const reconcile = (
    action: string,
    reservations: Reservation[],
    amounts: { grossAmount?: string; commissionAmount?: string } = {},
  ) =>
    request(app.getHttpServer())
      .post(ROUTE)
      .send({
        action,
        items: reservations.map(({ reservationRef }) => ({
          reservationRef,
          grossAmount: '400.00',
          commissionAmount: '60.00',
          ...amounts,
        })),
      });

  /** El número de la próxima reserva, para un código de confirmación único sin depender del azar. */
  let nextCode = 0;

  /** Una reserva de Booking de 400 USD con 15 % (60 USD), que salió en mayo de 2036. */
  const aBooking = (
    status: ReservationStatus = 'COMPLETED',
    commission: CommissionStatus = 'CALCULATED',
  ) =>
    app.get<ReservationRepository>(RESERVATION_REPOSITORY).insert(
      anOtaReservation(otaId, {
        status,
        startDate: '2036-05-10',
        endDate: '2036-05-12',
        ota: otaTerms(otaId, {
          externalConfirmationCode: `RC-${String((nextCode += 1)).padStart(8, '0')}`,
          grossAmount: Money.of('400', 'USD'),
          commissionPercentage: '15',
          commissionAmount: Money.of('60', 'USD'),
          commissionStatus: commission,
        }),
      }),
    );

  const commissionOf = async (reservation: Reservation) => {
    const [row]: {
      commission_status: string;
      commission_amount: string;
      status: string;
    }[] = await dataSource.query(
      `SELECT commission_status, commission_amount::text, status FROM reservation WHERE id = $1`,
      [reservation.id],
    );
    return row;
  };

  const auditOf = (
    reservation: Reservation,
  ): Promise<
    {
      action: string;
      previous_status: string | null;
      gross_amount: string;
      commission_percentage: string;
      commission_amount: string;
      channel: string;
      performed_by: string;
    }[]
  > =>
    dataSource.query(
      `SELECT action, previous_status, gross_amount::text, commission_percentage::text,
              commission_amount::text, channel, performed_by
       FROM commission_audit WHERE reservation_id = $1 ORDER BY occurred_at, action`,
      [reservation.id],
    );

  beforeAll(async () => {
    // AppConfigModule lee el entorno al importarse: AppModule se importa después de asignarlo.
    Object.assign(process.env, { NODE_ENV: 'test', ...integrationEnv() });
    const { AppModule } = await import('../../../src/app.module.js');
    server.listen({ onUnhandledRequest: 'bypass' });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CLOCK)
      .useValue(clock)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    dataSource = app.get(DataSource);
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    const ota = await app
      .get<OtaRepository>(OTA_REPOSITORY)
      .insert(anOta({ name: 'Booking.com' }));
    otaId = ota.id;
  });

  afterAll(async () => {
    if (dataSource !== undefined) {
      await truncateAllTables(dataSource);
    }
    server.close();
    await app?.close();
  });

  it('escenario 1: las COMPLETED en CALCULATED pasan a RECONCILED con los montos que coinciden, con auditoría de MODULE3', async () => {
    const first = await aBooking();
    const second = await aBooking();

    const res = await reconcile('RECONCILED', [first, second]).expect(200);

    expect(res.body).toEqual({
      action: 'RECONCILED',
      results: [first, second].map(({ reservationRef }) => ({
        reservationRef,
        result: 'APPLIED',
        commissionStatus: 'RECONCILED',
        reason: null,
      })),
      summary: { applied: 2, alreadyApplied: 0, rejected: 0 },
    });
    expect(await commissionOf(first)).toEqual({
      commission_status: 'RECONCILED',
      commission_amount: '60.00',
      status: 'COMPLETED',
    });
    expect(await auditOf(first)).toEqual([
      {
        action: 'RECONCILED',
        previous_status: 'CALCULATED',
        gross_amount: '400.00',
        commission_percentage: '15.00',
        commission_amount: '60.00',
        channel: 'MODULE3',
        performed_by: 'MODULE3',
      },
    ]);
  });

  it('escenario 1: con montos que no coinciden, AMOUNT_MISMATCH y la comisión no cambia', async () => {
    const reservation = await aBooking();

    const res = await reconcile('RECONCILED', [reservation], {
      commissionAmount: '61.00',
    }).expect(200);

    expect(res.body.results[0]).toMatchObject({
      result: 'REJECTED',
      commissionStatus: 'CALCULATED',
      reason: 'AMOUNT_MISMATCH',
    });
    expect((await commissionOf(reservation)).commission_status).toBe(
      'CALCULATED',
    );
    expect(await auditOf(reservation)).toEqual([]);
  });

  it('escenario 2: cancelada por Booking, la comisión no cambia ni al cancelar ni al conciliar (RESERVATION_CANCELLED)', async () => {
    const reservation = await aBooking('ACTIVE');
    await app.get<TransactionRunner>(TRANSACTION_RUNNER).run((tx) =>
      app.get<CancelReservation>(CANCEL_RESERVATION).cancel(tx, {
        reservationRef: reservation.reservationRef,
        channel: 'OTA_API',
        processedBy: 'Booking.com',
        reason: null,
      }),
    );
    expect(await commissionOf(reservation)).toEqual({
      commission_status: 'CALCULATED',
      commission_amount: '60.00',
      status: 'CANCELLED',
    });

    const res = await reconcile('RECONCILED', [reservation]).expect(200);

    expect(res.body.results[0]).toMatchObject({
      result: 'REJECTED',
      commissionStatus: 'CALCULATED',
      reason: 'RESERVATION_CANCELLED',
    });
    expect(await commissionOf(reservation)).toEqual({
      commission_status: 'CALCULATED',
      commission_amount: '60.00',
      status: 'CANCELLED',
    });
    expect(await auditOf(reservation)).toEqual([]);
  });

  it('escenario 3: en NO_SHOW, RESERVATION_NO_SHOW y la comisión no cambia', async () => {
    const reservation = await aBooking('NO_SHOW');

    const res = await reconcile('PAID', [reservation]).expect(200);

    expect(res.body.results[0]).toMatchObject({
      result: 'REJECTED',
      commissionStatus: 'CALCULATED',
      reason: 'RESERVATION_NO_SHOW',
    });
    expect((await commissionOf(reservation)).commission_status).toBe(
      'CALCULATED',
    );
  });

  it('FR-006: la conciliación repetida da ALREADY_APPLIED, sin cambios ni otra fila de auditoría', async () => {
    const reservation = await aBooking();
    await reconcile('RECONCILED', [reservation]).expect(200);

    const res = await reconcile('RECONCILED', [reservation]).expect(200);

    expect(res.body).toMatchObject({
      results: [{ result: 'ALREADY_APPLIED', commissionStatus: 'RECONCILED' }],
      summary: { applied: 0, alreadyApplied: 1, rejected: 0 },
    });
    expect(await auditOf(reservation)).toHaveLength(1);
  });

  it('RECONCILED y después PAID: dos filas de auditoría, cada una con su estado anterior', async () => {
    const reservation = await aBooking();

    await reconcile('RECONCILED', [reservation]).expect(200);
    await reconcile('PAID', [reservation]).expect(200);

    expect(
      (await auditOf(reservation)).map(({ action, previous_status }) => [
        action,
        previous_status,
      ]),
    ).toEqual([
      ['RECONCILED', 'CALCULATED'],
      ['PAID', 'RECONCILED'],
    ]);
    expect((await commissionOf(reservation)).commission_status).toBe('PAID');
  });

  it('una referencia que no existe se rechaza y las demás de la solicitud se aplican', async () => {
    const reservation = await aBooking();

    const res = await request(app.getHttpServer())
      .post(ROUTE)
      .send({
        action: 'RECONCILED',
        items: [
          {
            reservationRef: 'RSV-FFFFFFFF',
            grossAmount: '1.00',
            commissionAmount: '1.00',
          },
          {
            reservationRef: reservation.reservationRef,
            grossAmount: '400',
            commissionAmount: '60',
          },
        ],
      })
      .expect(200);

    expect(res.body.summary).toEqual({
      applied: 1,
      alreadyApplied: 0,
      rejected: 1,
    });
    expect(res.body.results[0]).toEqual({
      reservationRef: 'RSV-FFFFFFFF',
      result: 'REJECTED',
      commissionStatus: null,
      reason: 'RESERVATION_NOT_FOUND',
    });
  });

  it('dos actualizaciones a la vez de la misma reserva se procesan en secuencia: el estado final y la auditoría concuerdan', async () => {
    const reservation = await aBooking();

    const [reconciled, paid] = await Promise.all([
      reconcile('RECONCILED', [reservation]),
      reconcile('PAID', [reservation]),
    ]);

    const results = [reconciled.body.results[0], paid.body.results[0]] as {
      result: string;
      reason: string | null;
    }[];
    const applied = results.filter(({ result }) => result === 'APPLIED');
    expect((await commissionOf(reservation)).commission_status).toBe('PAID');
    expect(await auditOf(reservation)).toHaveLength(applied.length);
    // Si PAID entró primero, RECONCILED ya no está permitida; si no, las dos se aplican en orden.
    expect(
      applied.length === 2 ||
        results.some((r) => r.reason === 'INVALID_TRANSITION'),
    ).toBe(true);
  });

  it('un cuerpo inválido responde 400 sin procesar ningún ítem', async () => {
    const reservation = await aBooking();

    const res = await request(app.getHttpServer())
      .post(ROUTE)
      .send({
        action: 'RECONCILED',
        items: [
          {
            reservationRef: reservation.reservationRef,
            grossAmount: '400.00',
            commissionAmount: '60.00',
          },
          {
            reservationRef: reservation.reservationRef,
            grossAmount: '-1',
            commissionAmount: '60.00',
          },
        ],
      })
      .expect(400);

    expect(res.body.errorCode).toBe('INVALID_AMOUNT');
    expect((await commissionOf(reservation)).commission_status).toBe(
      'CALCULATED',
    );
  });
});
