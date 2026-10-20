import {
  ArgumentsHost,
  BadRequestException,
  Body,
  Controller,
  Get,
  INestApplication,
  InternalServerErrorException,
  Logger,
  Post,
  Res,
  ServiceUnavailableException,
  ValidationPipe,
} from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { IsString } from 'class-validator';
import type { Response } from 'express';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { vi } from 'vitest';
import {
  BusinessError,
  NotFoundError,
  TooManyRequestsError,
} from '../../../../src/domain/shared/business-error.js';
import { ApiError } from '../../../../src/infrastructure/shared/api-error.js';
import {
  ApiErrorFilter,
  UNEXPECTED_ERROR_MESSAGE,
} from '../../../../src/infrastructure/shared/api-error.filter.js';
import { validationExceptionFactory } from '../../../../src/infrastructure/shared/validation-exception.factory.js';

class ProbeDto {
  @IsString({
    message: 'La referencia de la reserva no es válida',
    context: { errorCode: 'INVALID_RESERVATION_REF' },
  })
  reservationRef!: string;
}

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

  @Get('api-error')
  apiError() {
    throw new ApiError('INVALID_HEADER', 'Falta la cabecera X-Client', 400);
  }

  @Get('api-error-5xx')
  apiError5xx() {
    throw new ApiError('MAL_USADO', 'Estado fuera de 4xx', 503);
  }

  @Post('dto')
  dto(@Body() body: ProbeDto) {
    return body;
  }

  @Get('nest-validation')
  nestValidation() {
    throw new BadRequestException(['primer mensaje', 'segundo mensaje']);
  }

  @Post('raw')
  raw(@Body() body: unknown) {
    return body;
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

  @Get('after-headers')
  afterHeaders(@Res() res: Response) {
    res.status(200).write('parcial');
    throw new Error('falló a mitad de la descarga');
  }
}

describe('ApiErrorFilter', () => {
  let app: INestApplication<App>;
  const logError = vi.spyOn(Logger.prototype, 'error');
  const logWarn = vi.spyOn(Logger.prototype, 'warn');

  beforeAll(async () => {
    logError.mockImplementation(() => {});
    logWarn.mockImplementation(() => {});
    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController],
      providers: [
        { provide: APP_FILTER, useClass: ApiErrorFilter },
        {
          provide: APP_PIPE,
          useValue: new ValidationPipe({
            exceptionFactory: validationExceptionFactory,
          }),
        },
      ],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  beforeEach(() => {
    logError.mockClear();
    logWarn.mockClear();
  });

  afterAll(async () => {
    await app.close();
    logError.mockRestore();
    logWarn.mockRestore();
  });

  const get = (path: string) => request(app.getHttpServer()).get(path);

  describe('errores de negocio y de la API', () => {
    it('responde el cuerpo uniforme con el código y el mensaje literal', async () => {
      const res = await get('/probe/business').expect(400);

      expect(res.body).toEqual({
        errorCode: 'NO_AVAILABILITY',
        message: 'No hay disponibilidad',
        timestamp: expect.any(String),
        path: '/probe/business',
      });
    });

    it('el timestamp es una fecha ISO en UTC y reciente', async () => {
      const before = Date.now();
      const { body } = await get('/probe/business');

      expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
      expect(Date.parse(body.timestamp)).toBeGreaterThanOrEqual(before - 1000);
      expect(Date.parse(body.timestamp)).toBeLessThanOrEqual(Date.now() + 1000);
    });

    it('NotFoundError responde 404 y TooManyRequestsError 429', async () => {
      const notFound = await get('/probe/not-found').expect(404);
      const limit = await get('/probe/limit').expect(429);

      expect(notFound.body.errorCode).toBe('RESERVATION_NOT_FOUND');
      expect(limit.body.errorCode).toBe('SIRE_RATE_LIMIT');
    });

    it('ApiError responde su código y su estado', async () => {
      const res = await get('/probe/api-error').expect(400);

      expect(res.body.errorCode).toBe('INVALID_HEADER');
      expect(res.body.message).toBe('Falta la cabecera X-Client');
    });

    it('un ApiError con estado fuera de 4xx responde 400 y deja un aviso', async () => {
      const res = await get('/probe/api-error-5xx').expect(400);

      expect(res.body.errorCode).toBe('MAL_USADO');
      expect(logWarn).toHaveBeenCalledTimes(1);
    });

    it('los errores controlados no se registran como errores', async () => {
      await get('/probe/business');
      await get('/probe/not-found');

      expect(logError).not.toHaveBeenCalled();
    });

    it('no incluye la consulta de la URL en el campo path', async () => {
      const res = await get(
        '/probe/business?search=CC1234567890&name=Ana',
      ).expect(400);

      expect(res.body.path).toBe('/probe/business');
      expect(JSON.stringify(res.body)).not.toContain('1234567890');
    });
  });

  describe('validación de la solicitud', () => {
    it('un DTO inválido responde el código y el mensaje del decorador', async () => {
      const res = await request(app.getHttpServer())
        .post('/probe/dto')
        .send({ reservationRef: 123 })
        .expect(400);

      expect(res.body.errorCode).toBe('INVALID_RESERVATION_REF');
      expect(res.body.message).toBe('La referencia de la reserva no es válida');
    });

    it('una validación de Nest con varios mensajes responde el primero', async () => {
      const res = await get('/probe/nest-validation').expect(400);

      expect(res.body.errorCode).toBe('INVALID_REQUEST');
      expect(res.body.message).toBe('primer mensaje');
    });
  });

  describe('errores de forma generados por el servidor', () => {
    it('una ruta inexistente responde 404 en español', async () => {
      const res = await get('/no-existe').expect(404);

      expect(res.body).toEqual({
        errorCode: 'INVALID_REQUEST',
        message: 'La ruta solicitada no existe.',
        timestamp: expect.any(String),
        path: '/no-existe',
      });
    });

    it('un JSON mal formado responde 400 sin el texto del intérprete', async () => {
      const res = await request(app.getHttpServer())
        .post('/probe/raw')
        .set('Content-Type', 'application/json')
        .send('{"roto":')
        .expect(400);

      expect(res.body.errorCode).toBe('INVALID_REQUEST');
      expect(res.body.message).toBe('La solicitud no es válida.');
    });

    it('un cuerpo demasiado grande responde 413 y no es un error no controlado', async () => {
      const res = await request(app.getHttpServer())
        .post('/probe/raw')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ texto: 'x'.repeat(200_000) }))
        .expect(413);

      expect(res.body.errorCode).toBe('INVALID_REQUEST');
      expect(res.body.message).toBe('La solicitud supera el tamaño permitido.');
      expect(logError).not.toHaveBeenCalled();
    });
  });

  describe('errores no controlados', () => {
    it.each(['crash', 'http-5xx', 'internal', 'string'])(
      'GET /probe/%s responde 400 controlado y nunca 5xx',
      async (route) => {
        const res = await get(`/probe/${route}`);

        expect(res.status).toBe(400);
        expect(res.body.errorCode).toBe('UNEXPECTED_ERROR');
        expect(res.body.message).toBe(UNEXPECTED_ERROR_MESSAGE);
      },
    );

    it('registra el detalle en el log', async () => {
      await get('/probe/crash');

      expect(logError).toHaveBeenCalledWith(
        expect.stringContaining('connection refused'),
        expect.any(String),
      );
    });

    it('no filtra datos de infraestructura en la respuesta', async () => {
      const crash = await get('/probe/crash');
      const unavailable = await get('/probe/http-5xx');
      const text = JSON.stringify([crash.body, unavailable.body]);

      for (const secret of [
        'postgres',
        'usuario',
        'clave',
        '10.0.0.5',
        'stack',
      ]) {
        expect(text).not.toContain(secret);
      }
    });

    it('si la respuesta ya empezó, la cierra sin romper la conexión', async () => {
      const res = await get('/probe/after-headers');

      expect(res.status).toBe(200);
      expect(res.text).toBe('parcial');
      expect(logError).toHaveBeenCalledTimes(1);
    });
  });

  it('fuera de HTTP vuelve a lanzar la excepción para la mensajería', () => {
    const filter = new ApiErrorFilter();
    const host = { getType: () => 'rmq' } as unknown as ArgumentsHost;
    const original = new BusinessError('ALGO', 'falló el consumidor');

    expect(() => filter.catch(original, host)).toThrow(original);
  });
});
