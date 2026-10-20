import {
  BadRequestException,
  Body,
  Controller,
  Get,
  INestApplication,
  InternalServerErrorException,
  Logger,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { vi } from 'vitest';
import request from 'supertest';
import { App } from 'supertest/types.js';
import {
  BusinessError,
  NotFoundError,
  TooManyRequestsError,
} from '../../../../src/domain/shared/api-error.js';
import {
  ApiErrorFilter,
  UNEXPECTED_ERROR,
  UNEXPECTED_ERROR_MESSAGE,
} from '../../../../src/infrastructure/shared/api-error.filter.js';

@Controller('probe')
class ProbeController {
  @Get('business')
  business() {
    throw new BusinessError('NO_AVAILABILITY', 'No hay disponibilidad');
  }

  @Get('not-found')
  notFound() {
    throw new NotFoundError('RESERVATION_NOT_FOUND', 'La reserva no existe');
  }

  @Get('limit')
  limit() {
    throw new TooManyRequestsError(
      'SIRE_RATE_LIMIT',
      'Demasiadas exportaciones',
    );
  }

  @Get('validation')
  validation() {
    throw new BadRequestException(['primer mensaje', 'segundo mensaje']);
  }

  @Get('http-5xx')
  http5xx() {
    throw new ServiceUnavailableException('base de datos caída en 10.0.0.5');
  }

  @Get('internal')
  internal() {
    throw new InternalServerErrorException('detalle interno');
  }

  @Get('crash')
  crash() {
    throw new Error(
      'connection refused to postgres://usuario:clave@10.0.0.5/hospitua',
    );
  }

  @Get('string')
  string() {
    throw 'algo que no es un Error';
  }

  @Post('body')
  body(@Body() body: unknown) {
    return body;
  }
}

describe('ApiErrorFilter', () => {
  let app: INestApplication<App>;
  let logError: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    logError = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController],
      providers: [{ provide: APP_FILTER, useClass: ApiErrorFilter }],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    logError.mockRestore();
  });

  it('responde con el código, el mensaje y el estado del error de negocio', async () => {
    const res = await request(app.getHttpServer())
      .get('/probe/business')
      .expect(400);

    expect(res.body).toEqual({
      errorCode: 'NO_AVAILABILITY',
      message: 'No hay disponibilidad',
      timestamp: expect.any(String),
      path: '/probe/business',
    });
  });

  it('el timestamp es una fecha ISO válida y reciente', async () => {
    const before = Date.now();
    const res = await request(app.getHttpServer()).get('/probe/business');
    const timestamp = Date.parse(res.body.timestamp);

    expect(new Date(res.body.timestamp).toISOString()).toBe(res.body.timestamp);
    expect(timestamp).toBeGreaterThanOrEqual(before - 1000);
    expect(timestamp).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('respeta el 404 y el 429 que piden los contratos', async () => {
    const notFound = await request(app.getHttpServer())
      .get('/probe/not-found')
      .expect(404);
    const limit = await request(app.getHttpServer())
      .get('/probe/limit')
      .expect(429);

    expect(notFound.body.errorCode).toBe('RESERVATION_NOT_FOUND');
    expect(limit.body.errorCode).toBe('SIRE_RATE_LIMIT');
  });

  it('no incluye la consulta de la URL en el campo path', async () => {
    const res = await request(app.getHttpServer())
      .get('/probe/business?search=CC1234567890&name=Ana')
      .expect(400);

    expect(res.body.path).toBe('/probe/business');
    expect(JSON.stringify(res.body)).not.toContain('1234567890');
  });

  it('una validación con varios mensajes responde 400 con el primero', async () => {
    const res = await request(app.getHttpServer())
      .get('/probe/validation')
      .expect(400);

    expect(res.body.errorCode).toBe('INVALID_REQUEST');
    expect(res.body.message).toBe('primer mensaje');
  });

  it('una ruta inexistente responde 404 con el cuerpo de error uniforme', async () => {
    const res = await request(app.getHttpServer())
      .get('/no-existe')
      .expect(404);

    expect(res.body).toEqual({
      errorCode: 'INVALID_REQUEST',
      message: expect.any(String),
      timestamp: expect.any(String),
      path: '/no-existe',
    });
  });

  it('un JSON mal formado responde 400, no 500', async () => {
    const res = await request(app.getHttpServer())
      .post('/probe/body')
      .set('Content-Type', 'application/json')
      .send('{"roto":')
      .expect(400);

    expect(res.body.errorCode).toBe('INVALID_REQUEST');
  });

  describe('errores no controlados', () => {
    it.each(['crash', 'http-5xx', 'internal', 'string'])(
      'GET /probe/%s responde 400 controlado y nunca 5xx',
      async (route) => {
        const res = await request(app.getHttpServer()).get(`/probe/${route}`);

        expect(res.status).toBe(400);
        expect(res.body.errorCode).toBe(UNEXPECTED_ERROR);
        expect(res.body.message).toBe(UNEXPECTED_ERROR_MESSAGE);
      },
    );

    it('registra el detalle del error en el log', async () => {
      logError.mockClear();
      await request(app.getHttpServer()).get('/probe/crash');

      expect(logError).toHaveBeenCalledWith(
        expect.stringContaining('connection refused'),
        expect.any(String),
      );
    });

    it('los errores controlados no se registran como errores', async () => {
      logError.mockClear();
      await request(app.getHttpServer()).get('/probe/business');

      expect(logError).not.toHaveBeenCalled();
    });

    it('no filtra datos de infraestructura en la respuesta', async () => {
      const crash = await request(app.getHttpServer()).get('/probe/crash');
      const unavailable = await request(app.getHttpServer()).get(
        '/probe/http-5xx',
      );
      const text = JSON.stringify([crash.body, unavailable.body]);

      expect(text).not.toContain('postgres');
      expect(text).not.toContain('usuario');
      expect(text).not.toContain('clave');
      expect(text).not.toContain('10.0.0.5');
      expect(text).not.toContain('stack');
    });
  });
});
