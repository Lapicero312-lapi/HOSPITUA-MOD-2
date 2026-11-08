import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CANCELLATION_REPOSITORY,
  type CancellationRepository,
} from '../../../../../src/application/ports/out/cancellation.repository.js';
import {
  OTA_REPOSITORY,
  type OtaRepository,
} from '../../../../../src/application/ports/out/ota.repository.js';
import {
  RESERVATION_REPOSITORY,
  type ReservationRepository,
} from '../../../../../src/application/ports/out/reservation.repository.js';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../../../src/application/ports/out/transaction.js';
import { AppModule } from '../../../../../src/app.module.js';
import { configureApp } from '../../../../../src/configure-app.js';
import { Cancellation } from '../../../../../src/domain/cancellation/cancellation.js';
import type { Reservation } from '../../../../../src/domain/reservation/reservation.js';
import {
  aDirectReservation,
  anOta,
  anOtaReservation,
  anOtaRoom,
} from '../../../../support/builders.js';

/**
 * La aplicación completa (`AppModule`) con la base de Testcontainers: comprueba que
 * `GET /api/reservations/{reservationRef}` está conectada con `GetReservationDetail`, con la lectura de
 * `X-Client` y el DTO de C3, y que sus errores salen por el filtro global (T016 y T017). Los escenarios de
 * la historia 2 los prueba T018.
 */
describe('GET /api/reservations/{reservationRef} (e2e, C3)', () => {
  let app: INestApplication<App>;
  let direct: Reservation;
  let ota: Reservation;
  let cancelled: Reservation;

  const detail = (reservationRef: string, client = 'RECEPTIONIST') =>
    request(app.getHttpServer())
      .get(`/api/reservations/${encodeURIComponent(reservationRef)}`)
      .set('X-Client', client);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    const reservations = app.get<ReservationRepository>(RESERVATION_REPOSITORY);
    // La base de las e2e es compartida: una agencia propia, para no chocar con el nombre único.
    const agency = await app
      .get<OtaRepository>(OTA_REPOSITORY)
      .insert(anOta({ name: `Agencia detalle e2e ${randomUUID()}` }));
    direct = await reservations.insert(
      aDirectReservation({ startDate: '2031-05-10', endDate: '2031-05-13' }),
    );
    ota = await reservations.insert(
      anOtaReservation(agency.id, {
        status: 'PENDING',
        rooms: [anOtaRoom({ roomId: null, roomNumber: null })],
      }),
    );
    cancelled = await reservations.insert(
      aDirectReservation({ status: 'CANCELLED' }),
    );
    await app.get<TransactionRunner>(TRANSACTION_RUNNER).run((tx) =>
      app.get<CancellationRepository>(CANCELLATION_REPOSITORY).insert(
        Cancellation.restore({
          id: randomUUID(),
          reservationRef: cancelled.reservationRef,
          cancellationDate: new Date('2031-05-01T14:30:00.000Z'),
          reason: 'El huésped cambió de planes',
          channel: 'RECEPTION',
          processedBy: 'Laura Gómez',
          status: 'COMPLETED',
        }),
        tx,
      ),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('responde 200 con el detalle de una directa: noches, importes como texto y createdAt en hora de Colombia', async () => {
    const res = await detail(direct.reservationRef).expect(200);

    expect(res.body).toMatchObject({
      reservationRef: direct.reservationRef,
      status: 'ACTIVE',
      source: 'DIRECT',
      otaName: null,
      startDate: '2031-05-10',
      endDate: '2031-05-13',
      nights: 3,
      guestCount: 2,
      cancellation: null,
      rooms: [
        {
          roomNumber: '201',
          categoryRoom: 'DOBLE',
          roomGrossAmount: { amount: '530000.00', currency: 'COP' },
          stayStatus: 'EXPECTED',
        },
      ],
    });
    expect(res.body.createdAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-05:00$/,
    );
  });

  it('una de Booking trae su agencia y su código, sin importe, y la habitación sin asignar en null', async () => {
    const res = await detail(ota.reservationRef).expect(200);

    expect(res.body).toMatchObject({
      source: 'OTA',
      otaName: expect.stringMatching(/^Agencia detalle e2e /),
      externalConfirmationCode: '4417829013',
      rooms: [{ roomId: null, roomNumber: null, roomGrossAmount: null }],
      guest: { documentType: null, documentNumber: null },
    });
  });

  it('una cancelada trae su cancelación (historia 2, escenario 4)', async () => {
    const res = await detail(cancelled.reservationRef).expect(200);

    expect(res.body.cancellation).toEqual({
      cancellationDate: '2031-05-01T09:30:00-05:00',
      channel: 'RECEPTION',
      reason: 'El huésped cambió de planes',
      processedBy: 'Laura Gómez',
    });
  });

  it.each([
    [
      'inexistente',
      'RSV-00000000',
      'RESERVATION_NOT_FOUND',
      'La reserva no existe.',
    ],
    [
      'con otro formato',
      'RSV-zz',
      'INVALID_RESERVATION_CODE',
      'Debe proveer un código de reserva válido para la consulta.',
    ],
  ])(
    'una referencia %s responde 400 %s',
    async (_, reservationRef, errorCode, message) => {
      const res = await detail(reservationRef).expect(400);

      expect(res.body).toMatchObject({ errorCode, message });
    },
  );

  it.each(['MODULE1', 'MODULE3', 'OTRO'])(
    'con X-Client %s responde 400 INVALID_CLIENT (C4 llega con T032)',
    async (client) => {
      const res = await detail(direct.reservationRef, client).expect(400);

      expect(res.body.errorCode).toBe('INVALID_CLIENT');
    },
  );

  it('sin X-Client responde 400 INVALID_CLIENT', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/reservations/${direct.reservationRef}`)
      .expect(400);

    expect(res.body.errorCode).toBe('INVALID_CLIENT');
  });
});
