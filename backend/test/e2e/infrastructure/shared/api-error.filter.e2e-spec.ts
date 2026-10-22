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
import request from 'supertest';
import { App } from 'supertest/types.js';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { BusinessError } from '../../../../src/domain/shared/business-error.js';
import { ApiError } from '../../../../src/infrastructure/shared/api-error.js';
import { ApiErrorFilter } from '../../../../src/infrastructure/shared/api-error.filter.js';

@Controller('probe')
class ProbeController {
  @Get('business')
  business() {
    throw new BusinessError(
      'NO_AVAILABILITY',
      'Ya no hay disponibilidad para las fechas solicitadas.',
    );
  }

  @Get('api-error')
  apiError() {
    throw new ApiError(
      'IDEMPOTENCY_KEY_REQUIRED',
      'Falta el identificador de la solicitud.',
    );
  }

  @Get('api-error-429')
  apiError429() {
    throw new ApiError(
      'TOO_MANY_REQUESTS',
      'Se superó el límite de solicitudes de exportación. Intente de nuevo en unos segundos.',
      429,
    );
  }

  @Get('api-error-5xx')
  apiError5xx() {
    throw new ApiError(
      'NO_AVAILABILITY',
      'Ya no hay disponibilidad para las fechas solicitadas.',
      503,
    );
  }

  @Get('nest-400')
  nest400() {
    throw new BadRequestException('detalle de Nest');
  }

  @Get('nest-503')
  nest503() {
    throw new ServiceUnavailableException('base de datos caída en 10.0.0.5');
  }

  @Get('nest-500')
  nest500() {
    throw new InternalServerErrorException('detalle interno');
  }

  @Get('crash')
  crash() {
    throw new Error(
      'connection refused to postgres://usuario:clave@10.0.0.5/hospitua',
    );
  }

  @Get('not-an-error')
  notAnError() {
    throw 'documento CC 1234567890';
  }

  @Post('raw')
  raw(@Body() body: unknown) {
    return body;
  }
}

describe('ApiErrorFilter', () => {
  let app: INestApplication<App>;
  const logError = vi.spyOn(Logger.prototype, 'error');

  beforeAll(async () => {
    logError.mockImplementation(() => {});
    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController],
      providers: [{ provide: APP_FILTER, useClass: ApiErrorFilter }],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  beforeEach(() => {
    logError.mockClear();
  });

  afterAll(async () => {
    await app.close();
    logError.mockRestore();
  });

  const get = (path: string) => request(app.getHttpServer()).get(path);

  describe('BusinessError', () => {
    it('responde 400 con el cuerpo { errorCode, message, timestamp, path }', async () => {
      const res = await get('/probe/business').expect(400);

      expect(res.body).toEqual({
        errorCode: 'NO_AVAILABILITY',
        message: 'Ya no hay disponibilidad para las fechas solicitadas.',
        timestamp: expect.any(String),
        path: '/probe/business',
      });
    });

    it('no se registra como error en el log', async () => {
      await get('/probe/business');

      expect(logError).not.toHaveBeenCalled();
    });
  });

  describe('ApiError', () => {
    it('responde su código, su mensaje y 400 por defecto', async () => {
      const res = await get('/probe/api-error').expect(400);

      expect(res.body.errorCode).toBe('IDEMPOTENCY_KEY_REQUIRED');
      expect(res.body.message).toBe('Falta el identificador de la solicitud.');
    });

    it('responde su estado cuando es 4xx', async () => {
      const res = await get('/probe/api-error-429').expect(429);

      expect(res.body.errorCode).toBe('TOO_MANY_REQUESTS');
    });

    it('con un estado fuera de 4xx responde 400', async () => {
      const res = await get('/probe/api-error-5xx').expect(400);

      expect(res.body.errorCode).toBe('NO_AVAILABILITY');
    });
  });

  describe('cualquier otra excepción', () => {
    it.each([
      ['un Error', '/probe/crash'],
      ['algo que no es un Error', '/probe/not-an-error'],
      ['un 400 de Nest', '/probe/nest-400'],
      ['un 500 de Nest', '/probe/nest-500'],
      ['un 503 de Nest', '/probe/nest-503'],
      ['una ruta inexistente', '/does-not-exist'],
    ])(
      '%s responde 400 REQUEST_NOT_PROCESSED y nunca otro estado',
      async (_, path) => {
        const res = await get(path);

        expect(res.status).toBe(400);
        expect(res.body.errorCode).toBe('REQUEST_NOT_PROCESSED');
        expect(res.body.message).toBe('No fue posible procesar la solicitud.');
      },
    );

    it('un JSON mal formado responde 400 REQUEST_NOT_PROCESSED', async () => {
      const res = await request(app.getHttpServer())
        .post('/probe/raw')
        .set('Content-Type', 'application/json')
        .send('{"roto":')
        .expect(400);

      expect(res.body.errorCode).toBe('REQUEST_NOT_PROCESSED');
    });

    it('registra el detalle en el log', async () => {
      await get('/probe/crash');

      expect(logError).toHaveBeenCalledWith(
        expect.stringContaining('connection refused'),
        expect.any(String),
      );
    });

    it('si no es un Error, registra solo su tipo y no su contenido', async () => {
      await get('/probe/not-an-error');

      expect(logError).toHaveBeenCalledWith(
        'Se lanzó un valor que no es un Error (tipo: string)',
      );
      expect(JSON.stringify(logError.mock.calls)).not.toContain('1234567890');
    });

    it('no responde datos de infraestructura', async () => {
      const crash = await get('/probe/crash');
      const unavailable = await get('/probe/nest-503');
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
  });

  it('el timestamp es una fecha ISO 8601 en UTC y reciente', async () => {
    const before = Date.now();
    const { body } = await get('/probe/business');

    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
    expect(Date.parse(body.timestamp)).toBeGreaterThanOrEqual(before - 1000);
    expect(Date.parse(body.timestamp)).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('path es la ruta de la solicitud, sin la consulta', async () => {
    const res = await get('/probe/business?search=CC1234567890');

    expect(res.body.path).toBe('/probe/business');
  });
});
