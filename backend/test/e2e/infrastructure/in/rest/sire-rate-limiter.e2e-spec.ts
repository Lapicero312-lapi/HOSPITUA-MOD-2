import {
  Controller,
  INestApplication,
  Post,
  UseInterceptors,
} from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { configureApp } from '../../../../../src/configure-app.js';
import {
  SIRE_REQUEST_LIMITS,
  SireRateLimiter,
  SireRequestLimits,
} from '../../../../../src/infrastructure/in/rest/sire-rate-limiter.js';
import { ApiErrorFilter } from '../../../../../src/infrastructure/shared/api-error.filter.js';

/** Una ruta con el limitador, como lo usará `POST /api/sire/exports` (T008). */
@Controller('probe-sire')
class ProbeSireController {
  @Post('exports')
  @UseInterceptors(SireRateLimiter)
  export() {
    return { exported: true };
  }
}

/**
 * El limitador en una aplicación de Nest con el filtro global: el 429 sale con su cuerpo de error, su
 * cabecera `Retry-After` y su estado, que el filtro conserva porque es 4xx.
 */
describe('SireRateLimiter (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeSireController],
      providers: [
        { provide: APP_FILTER, useClass: ApiErrorFilter },
        // Como lo hará el módulo del controlador de SIRE: Nest crea el interceptor e inyecta los límites.
        {
          provide: SIRE_REQUEST_LIMITS,
          useValue: new SireRequestLimits({ perMinute: 1, maxConcurrent: 3 }),
        },
      ],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const post = () =>
    request(app.getHttpServer()).post('/api/probe-sire/exports');

  it('sin X-User responde 400 USER_REQUIRED', async () => {
    const res = await post().expect(400);

    expect(res.body).toMatchObject({ errorCode: 'USER_REQUIRED' });
  });

  it('la primera del minuto pasa y la segunda responde 429 con Retry-After y el cuerpo de error', async () => {
    await post().set('X-User', 'Ana Recepción').expect(201);

    const res = await post().set('X-User', 'Ana Recepción').expect(429);

    expect(res.headers['retry-after']).toMatch(/^(59|60)$/);
    expect(res.body).toEqual({
      errorCode: 'TOO_MANY_REQUESTS',
      message:
        'Se superó el límite de solicitudes de exportación. Intente de nuevo en unos segundos.',
      timestamp: expect.any(String),
      path: '/api/probe-sire/exports',
    });
  });

  it('otro usuario no queda limitado por el primero', async () => {
    await post().set('X-User', 'Luis Recepción').expect(201);
  });
});
