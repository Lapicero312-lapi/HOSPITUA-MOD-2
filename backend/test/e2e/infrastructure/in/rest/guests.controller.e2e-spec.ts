import { randomInt } from 'node:crypto';
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
import { aDirectReservation, aGuest } from '../../../../support/builders.js';

/** Un número propio de esta prueba, para no depender de lo que guarden otras. */
const DOCUMENT_NUMBER = `E2E-${randomInt(1_000_000)}`;

/**
 * La aplicación completa (`AppModule`) con la base de datos de Testcontainers: comprueba que
 * `GET /api/guests/lookup` está conectada con su caso de uso y que sus errores salen por el filtro
 * global. Los escenarios 10 y 11 los prueba `test/integration/generate-direct-reservation`.
 */
describe('GET /api/guests/lookup (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    await app.get<ReservationRepository>(RESERVATION_REPOSITORY).insert(
      aDirectReservation({
        guest: aGuest({ documentType: 'PAS', documentNumber: DOCUMENT_NUMBER }),
      }),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('responde 200 con los datos del titular, sin su id', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/guests/lookup')
      .query({ documentType: 'PAS', documentNumber: DOCUMENT_NUMBER })
      .expect(200)
      .expect('Content-Type', /application\/json/);

    expect(res.body).toEqual({
      found: true,
      guest: {
        firstName: 'Valentina',
        lastName: 'Ospina',
        documentType: 'PAS',
        documentNumber: DOCUMENT_NUMBER,
        nationality: 'Colombia',
        contactPhone: '+57 300 000 0000',
        contactEmail: 'valentina@correo.com',
      },
    });
  });

  it('responde 200 con found false si no hay ninguna reserva con ese documento', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/guests/lookup')
      .query({ documentType: 'CC', documentNumber: DOCUMENT_NUMBER })
      .expect(200);

    expect(res.body).toEqual({ found: false, guest: null });
  });

  it.each([
    ['sin el número', 'documentType=CC', 'GUEST_DATA_REQUIRED'],
    [
      'con un tipo que no existe',
      'documentType=DNI&documentNumber=123',
      'INVALID_DOCUMENT_TYPE',
    ],
    [
      'con el tipo repetido',
      'documentType=CC&documentType=TI&documentNumber=123',
      'INVALID_DOCUMENT_TYPE',
    ],
    [
      'con un punto en el número',
      'documentType=CC&documentNumber=1.144',
      'INVALID_CHARACTERS',
    ],
  ])('responde 400 %s', async (_caso, query, errorCode) => {
    const res = await request(app.getHttpServer())
      .get(`/api/guests/lookup?${query}`)
      .expect(400);

    // La ruta sale sin la consulta: el número de documento no viaja en el error.
    expect(res.body).toMatchObject({ errorCode, path: '/api/guests/lookup' });
    expect(res.body).toHaveProperty('message');
    expect(res.body).toHaveProperty('timestamp');
  });
});
