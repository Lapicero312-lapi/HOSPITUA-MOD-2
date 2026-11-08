import { randomInt, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  GUEST_DATA_REPOSITORY,
  type GuestDataRepository,
} from '../../../../../src/application/ports/out/guest-data.repository.js';
import {
  MIGRATORY_MOVEMENT_REPOSITORY,
  type MigratoryMovementRepository,
} from '../../../../../src/application/ports/out/migratory-movement.repository.js';
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
import { GuestData } from '../../../../../src/domain/migration/guest-data.js';
import { MigratoryMovement } from '../../../../../src/domain/migration/migratory-movement.js';
import { aDirectReservation } from '../../../../support/builders.js';

/** Un documento propio de esta prueba, para no depender de lo que guarden otras. */
const DOCUMENT_NUMBER = `E2E${randomInt(1_000_000)}`;

/**
 * La aplicación completa (`AppModule`) con la base de Testcontainers: comprueba que `GET /api/guest-stays`
 * está conectada con su caso de uso y su consulta, y que los filtros inválidos salen por el filtro global
 * sin consultar. Cada filtro lo prueba la consulta contra PostgreSQL; los escenarios, la T018.
 */
describe('GET /api/guest-stays (e2e)', () => {
  let app: INestApplication<App>;
  let reservationRef: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();

    const reservation = await app
      .get<ReservationRepository>(RESERVATION_REPOSITORY)
      .insert(aDirectReservation());
    reservationRef = reservation.reservationRef;
    const guest = GuestData.restore({
      id: randomUUID(),
      reservationRef,
      firstName: 'John',
      lastName: 'Smith',
      documentType: 'PAS',
      documentNumber: DOCUMENT_NUMBER,
      birthDate: '1990-05-12',
      nationality: 'Estados Unidos',
      originPlace: 'Miami, Estados Unidos',
      destinationPlace: 'Cartagena, Colombia',
    });
    await app.get<TransactionRunner>(TRANSACTION_RUNNER).run(async (tx) => {
      await app
        .get<GuestDataRepository>(GUEST_DATA_REPOSITORY)
        .insertMissing([guest], tx);
      await app
        .get<MigratoryMovementRepository>(MIGRATORY_MOVEMENT_REPOSITORY)
        .insertMissing(
          [
            MigratoryMovement.restore({
              id: randomUUID(),
              guestDataId: guest.id,
              movementType: 'ENTRY',
              movementDate: '2026-10-09',
            }),
          ],
          tx,
        );
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('responde 200 con la forma de C1: John en el hotel, extranjero', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/guest-stays')
      .query({ search: DOCUMENT_NUMBER, nationality: 'FOREIGN' })
      .expect(200)
      .expect('Content-Type', /application\/json/);

    expect(res.body).toEqual({
      items: [
        {
          reservationRef,
          guest: {
            firstName: 'John',
            lastName: 'Smith',
            documentType: 'PAS',
            documentNumber: DOCUMENT_NUMBER,
            nationality: 'Estados Unidos',
            isForeign: true,
          },
          entryDate: '2026-10-09',
          exitDate: null,
          inHotel: true,
        },
      ],
      page: 1,
      pageSize: 10,
      totalItems: 1,
      totalPages: 1,
      message: null,
    });
  });

  it('sin resultados responde 200 con la lista vacía y el mensaje', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/guest-stays')
      .query({ search: DOCUMENT_NUMBER, nationality: 'COLOMBIAN' })
      .expect(200);

    expect(res.body).toEqual({
      items: [],
      page: 1,
      pageSize: 10,
      totalItems: 0,
      totalPages: 0,
      message: 'No hay huéspedes que coincidan con los filtros.',
    });
  });

  it.each([
    [
      'una nacionalidad que no existe',
      'nationality=EXTRANJERO',
      'INVALID_NATIONALITY_FILTER',
    ],
    [
      'una situación que no existe',
      'presence=HOSPEDADO',
      'INVALID_PRESENCE_FILTER',
    ],
    ['una sola fecha', 'dateFrom=2026-10-01', 'INCOMPLETE_DATE_RANGE'],
    [
      'un rango invertido',
      'dateFrom=2026-10-31&dateTo=2026-10-01',
      'INVALID_DATE_RANGE',
    ],
    ['un nombre de 2 letras', 'search=al', 'NAME_SEARCH_TOO_SHORT'],
    ['la página 0', 'page=0', 'INVALID_PAGE'],
  ])('responde 400 con %s', async (_caso, query, errorCode) => {
    const res = await request(app.getHttpServer())
      .get(`/api/guest-stays?${query}`)
      .expect(400);

    expect(res.body).toMatchObject({ errorCode, path: '/api/guest-stays' });
    expect(res.body).toHaveProperty('message');
  });

  describe('C2: GET /api/reservations/{reservationRef}/guests/{documentNumber}', () => {
    it('responde 200 con la forma de C2: John con su enlace a la reserva y su entrada', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/reservations/${reservationRef}/guests/${DOCUMENT_NUMBER}`)
        .expect(200)
        .expect('Content-Type', /application\/json/);

      expect(res.body).toEqual({
        reservationRef,
        reservationLink: `/api/reservations/${reservationRef}`,
        guest: {
          documentType: 'PAS',
          documentNumber: DOCUMENT_NUMBER,
          firstName: 'John',
          lastName: 'Smith',
          birthDate: '1990-05-12',
          nationality: 'Estados Unidos',
          isForeign: true,
          originPlace: 'Miami, Estados Unidos',
          destinationPlace: 'Cartagena, Colombia',
        },
        movements: [{ movementType: 'ENTRY', movementDate: '2026-10-09' }],
      });
    });

    it.each([
      [
        'un huésped que no está en la reserva',
        () => `/api/reservations/${reservationRef}/guests/NOEXISTE1`,
        'GUEST_NOT_FOUND',
      ],
      [
        'una reserva que no existe',
        () => `/api/reservations/RSV-00000000/guests/${DOCUMENT_NUMBER}`,
        'GUEST_NOT_FOUND',
      ],
      [
        'una referencia con otro formato',
        () => `/api/reservations/RSV-123/guests/${DOCUMENT_NUMBER}`,
        'INVALID_RESERVATION_CODE',
      ],
      [
        'un documento con caracteres no permitidos',
        () => `/api/reservations/${reservationRef}/guests/X99%3B`,
        'INVALID_DOCUMENT_NUMBER',
      ],
      [
        'un documento en blanco',
        () => `/api/reservations/${reservationRef}/guests/%20`,
        'INVALID_DOCUMENT_NUMBER',
      ],
      [
        'el documento vacío',
        () => `/api/reservations/${reservationRef}/guests/`,
        'INVALID_DOCUMENT_NUMBER',
      ],
      [
        'sin documento',
        () => `/api/reservations/${reservationRef}/guests`,
        'INVALID_DOCUMENT_NUMBER',
      ],
      [
        'sin documento y con la referencia mala: primero la referencia',
        () => '/api/reservations/RSV-123/guests',
        'INVALID_RESERVATION_CODE',
      ],
    ])('responde 400 con %s', async (_caso, path, errorCode) => {
      const url = path();
      const res = await request(app.getHttpServer()).get(url).expect(400);

      expect(res.body).toMatchObject({ errorCode, path: url });
      expect(res.body).toHaveProperty('message');
      expect(res.body).toHaveProperty('timestamp');
    });
  });
});
