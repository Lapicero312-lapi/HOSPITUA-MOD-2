import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  RESERVATION_REPOSITORY,
  type ReservationRepository,
} from '../../../../../src/application/ports/out/reservation.repository.js';
import { AppModule } from '../../../../../src/app.module.js';
import { configureApp } from '../../../../../src/configure-app.js';
import type { Reservation } from '../../../../../src/domain/reservation/reservation.js';
import { aDirectReservation } from '../../../../support/builders.js';

/**
 * La aplicación completa (`AppModule`) con la base de Testcontainers: comprueba que
 * `POST /api/reservations/{reservationRef}/cancellation` está conectada con `CancelReservation`, la
 * transacción y el filtro global (T008 de `cancel-reservation`). Las reglas, una por una, las prueban
 * `CancelReservation` y sus pruebas de integración; los escenarios del spec, la T011 y la T012. La
 * reserva tiene una llegada lejana, para no tocar la lista del día.
 */
describe('POST /api/reservations/{reservationRef}/cancellation (e2e)', () => {
  let app: INestApplication<App>;
  let reservations: ReservationRepository;
  let dataSource: DataSource;

  /** Una reserva directa nueva, guardada, con llegada en 2031. */
  const aStoredReservation = (status: 'ACTIVE' | 'IN_PROGRESS' = 'ACTIVE') =>
    reservations.insert(
      aDirectReservation({
        status,
        startDate: '2031-05-10',
        endDate: '2031-05-12',
      }),
    );

  const cancel = (
    reservationRef: string,
    body: unknown,
    user: string | null = 'laura.mendez',
  ) => {
    const call = request(app.getHttpServer()).post(
      `/api/reservations/${reservationRef}/cancellation`,
    );
    return (user === null ? call : call.set('X-User', user)).send(
      body as object,
    );
  };

  /** El cuerpo del contrato A para esa reserva, con el `updatedAt` que guardó la base. */
  const bodyFor = (reservation: Reservation, changes: object = {}) => ({
    updatedAt: reservation.updatedAt,
    acknowledged: true,
    reason: 'El huésped cambió de planes',
    ...changes,
  });

  const statusOf = async (reservationRef: string) =>
    (await reservations.findByRef(reservationRef))?.status;

  const cancellationsOf = (reservationRef: string) =>
    dataSource.query(
      `SELECT c.channel, c.reason, c.processed_by, c.status
       FROM cancellation c JOIN reservation r ON r.id = c.reservation_id
       WHERE r.reservation_ref = $1`,
      [reservationRef],
    );

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    reservations = app.get<ReservationRepository>(RESERVATION_REPOSITORY);
    dataSource = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  it('escenario 1: responde 200 con la forma de A, la reserva queda CANCELLED y su Cancellation registrada', async () => {
    const reservation = await aStoredReservation();

    const res = await cancel(
      reservation.reservationRef,
      bodyFor(reservation),
    ).expect(200);

    expect(res.body).toEqual({
      reservationRef: reservation.reservationRef,
      status: 'CANCELLED',
      cancellation: {
        cancellationId: expect.stringMatching(/^[0-9a-f-]{36}$/) as string,
        cancellationDate: expect.stringMatching(
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-05:00$/,
        ) as string,
        channel: 'RECEPTION',
        reason: 'El huésped cambió de planes',
        processedBy: 'laura.mendez',
        status: 'COMPLETED',
      },
    });
    await expect(statusOf(reservation.reservationRef)).resolves.toBe(
      'CANCELLED',
    );
    await expect(cancellationsOf(reservation.reservationRef)).resolves.toEqual([
      {
        channel: 'RECEPTION',
        reason: 'El huésped cambió de planes',
        processed_by: 'laura.mendez',
        status: 'COMPLETED',
      },
    ]);
  });

  it('D2: la misma cancelación otra vez responde CONCURRENT_UPDATE y deja una sola Cancellation', async () => {
    const reservation = await aStoredReservation();
    await cancel(reservation.reservationRef, bodyFor(reservation)).expect(200);

    const res = await cancel(
      reservation.reservationRef,
      bodyFor(reservation),
    ).expect(400);

    expect(res.body).toMatchObject({ errorCode: 'CONCURRENT_UPDATE' });
    await expect(
      cancellationsOf(reservation.reservationRef),
    ).resolves.toHaveLength(1);
  });

  it.each([
    ['sin X-User', { user: null }, 'USER_REQUIRED'],
    [
      'sin acknowledged',
      { body: { acknowledged: undefined } },
      'CANCELLATION_NOT_CONFIRMED',
    ],
    [
      'con acknowledged como texto',
      { body: { acknowledged: 'true' } },
      'CANCELLATION_NOT_CONFIRMED',
    ],
    ['sin updatedAt', { body: { updatedAt: undefined } }, 'CONCURRENT_UPDATE'],
    [
      'con otro updatedAt',
      { body: { updatedAt: '2020-01-01T00:00:00.000000-05:00' } },
      'CONCURRENT_UPDATE',
    ],
    [
      'un motivo de más de 500 caracteres',
      { body: { reason: 'a'.repeat(501) } },
      'REASON_TOO_LONG',
    ],
    [
      'un motivo que no es texto',
      { body: { reason: 42 } },
      'INVALID_CHARACTERS',
    ],
  ])(
    'responde 400 %s, sin cancelar',
    async (
      _caso,
      { user, body }: { user?: null; body?: object },
      errorCode,
    ) => {
      const reservation = await aStoredReservation();

      const res = await cancel(
        reservation.reservationRef,
        bodyFor(reservation, body),
        user,
      ).expect(400);

      expect(res.body).toMatchObject({
        errorCode,
        path: `/api/reservations/${reservation.reservationRef}/cancellation`,
      });
      expect(res.body).toHaveProperty('message');
      expect(res.body).toHaveProperty('timestamp');
      await expect(statusOf(reservation.reservationRef)).resolves.toBe(
        'ACTIVE',
      );
      await expect(
        cancellationsOf(reservation.reservationRef),
      ).resolves.toEqual([]);
    },
  );

  it.each([
    ['una referencia en blanco', '%20%20', 'RESERVATION_REF_REQUIRED'],
    ['una referencia con otro formato', 'RSV-123', 'INVALID_RESERVATION_CODE'],
    ['una reserva que no existe', 'RSV-00000000', 'RESERVATION_NOT_FOUND'],
  ])('responde 400 con %s', async (_caso, reservationRef, errorCode) => {
    const res = await cancel(reservationRef, {
      updatedAt: '2026-10-08T15:42:10.123456-05:00',
      acknowledged: true,
    }).expect(400);

    expect(res.body).toMatchObject({ errorCode });
  });

  it('una reserva que ya tuvo Check-In responde STATUS_NOT_CANCELLABLE y no cambia', async () => {
    const reservation = await aStoredReservation('IN_PROGRESS');

    const res = await cancel(
      reservation.reservationRef,
      bodyFor(reservation),
    ).expect(400);

    expect(res.body).toMatchObject({ errorCode: 'STATUS_NOT_CANCELLABLE' });
    await expect(statusOf(reservation.reservationRef)).resolves.toBe(
      'IN_PROGRESS',
    );
  });
});
