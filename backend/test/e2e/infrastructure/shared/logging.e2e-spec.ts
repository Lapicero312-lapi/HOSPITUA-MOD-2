import { Writable } from 'node:stream';
import {
  Body,
  Controller,
  Get,
  INestApplication,
  Param,
  Post,
} from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Logger, LoggerModule } from 'nestjs-pino';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { configureApp } from '../../../../src/configure-app.js';
import { BusinessError } from '../../../../src/domain/shared/business-error.js';
import { ApiErrorFilter } from '../../../../src/infrastructure/shared/api-error.filter.js';
import { pinoHttpOptions } from '../../../../src/infrastructure/shared/logging.options.js';
import { RoutePatternInterceptor } from '../../../../src/infrastructure/shared/route-pattern.interceptor.js';

@Controller('probe')
class ProbeController {
  @Get(':reservationRef')
  find(@Param('reservationRef') reservationRef: string) {
    return { reservationRef };
  }

  @Get(':reservationRef/unavailable')
  unavailable() {
    throw new BusinessError(
      'NO_AVAILABILITY',
      'Ya no hay disponibilidad para las fechas solicitadas.',
    );
  }

  @Get(':reservationRef/crash')
  crash() {
    throw new Error('connection refused to 10.0.0.5');
  }

  @Post('guests')
  create(@Body() body: unknown) {
    return body;
  }
}

/** Una línea de log de pino (JSON). */
type LogLine = {
  level: number;
  msg: string;
  correlationId?: string;
  req?: { method: string; client: string | null };
  route?: string | null;
  res?: { statusCode: number; errorCode?: string };
};

const INFO = 30;
const WARN = 40;
const ERROR = 50;

describe('Logs y correlación (nestjs-pino)', () => {
  let app: INestApplication<App>;
  let output: string[] = [];

  const lines = (): LogLine[] => output.map((line) => JSON.parse(line));
  const requestLog = (): LogLine | undefined =>
    lines().find((line) => line.req !== undefined);

  /** El log de la solicitud se escribe al terminar la respuesta: se espera a que aparezca. */
  const waitForRequestLog = async (): Promise<LogLine> => {
    for (let attempt = 0; attempt < 50 && !requestLog(); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const line = requestLog();
    if (!line) {
      throw new Error('No se escribió el log de la solicitud');
    }
    return line;
  };

  beforeAll(async () => {
    const destination = new Writable({
      write(chunk: Buffer, _encoding, done) {
        output.push(...chunk.toString().trim().split('\n'));
        done();
      },
    });

    const moduleRef = await Test.createTestingModule({
      imports: [
        LoggerModule.forRoot({
          pinoHttp: [pinoHttpOptions('info'), destination],
        }),
      ],
      controllers: [ProbeController],
      providers: [
        { provide: APP_FILTER, useClass: ApiErrorFilter },
        { provide: APP_INTERCEPTOR, useClass: RoutePatternInterceptor },
      ],
    }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    app.useLogger(app.get(Logger));
    configureApp(app);
    await app.init();
  });

  beforeEach(() => {
    output = [];
  });

  afterAll(async () => {
    await app.close();
  });

  describe('correlationId', () => {
    it('reutiliza el X-Correlation-Id válido y lo devuelve en la respuesta', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/probe/RSV-3F9A1C7B')
        .set('X-Correlation-Id', 'modulo1-abc_123')
        .expect(200);

      expect(res.headers['x-correlation-id']).toBe('modulo1-abc_123');
      expect((await waitForRequestLog()).correlationId).toBe('modulo1-abc_123');
    });

    it('si no llega o no es válido, genera uno nuevo y no repite el recibido', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/probe/RSV-3F9A1C7B')
        .set('X-Correlation-Id', '<script>')
        .expect(200);

      const correlationId = res.headers['x-correlation-id'];
      expect(correlationId).toMatch(/^[0-9a-f-]{36}$/);
      expect((await waitForRequestLog()).correlationId).toBe(correlationId);
      expect(output.join('\n')).not.toContain('<script>');
    });

    it('va también en el log que escribe el filtro durante la solicitud', async () => {
      const res = await request(app.getHttpServer()).get(
        '/api/probe/RSV-3F9A1C7B/crash',
      );
      await waitForRequestLog();

      const filterLog = lines().find((line) => line.level === ERROR);
      expect(filterLog?.correlationId).toBe(res.headers['x-correlation-id']);
    });
  });

  describe('qué se registra de la solicitud', () => {
    it('solo el método, el patrón de la ruta y X-Client', async () => {
      await request(app.getHttpServer())
        .get('/api/probe/RSV-3F9A1C7B?search=1144093552')
        .set('X-Client', 'RECEPTIONIST')
        .set('X-User', 'laura.mendez')
        .expect(200);

      const log = await waitForRequestLog();
      expect(log.req).toEqual({ method: 'GET', client: 'RECEPTIONIST' });
      expect(log.route).toBe('/api/probe/:reservationRef');
      expect(log.level).toBe(INFO);
    });

    it('nunca la ruta real, la consulta, las cabeceras ni el cuerpo', async () => {
      await request(app.getHttpServer())
        .get('/api/probe/RSV-3F9A1C7B?search=1144093552')
        .set('X-User', 'laura.mendez')
        .set('Authorization', 'Bearer secreto');
      await request(app.getHttpServer())
        .post('/api/probe/guests')
        .send({ documentNumber: '99887766', firstName: 'Ana' });
      await waitForRequestLog();
      await new Promise((resolve) => setTimeout(resolve, 50));

      const text = output.join('\n');
      for (const personal of [
        'RSV-3F9A1C7B',
        '1144093552',
        'search',
        'laura.mendez',
        'secreto',
        '99887766',
        'Ana',
        'headers',
      ]) {
        expect(text).not.toContain(personal);
      }
    });

    it('un X-Client desconocido se registra como INVALID', async () => {
      await request(app.getHttpServer())
        .get('/api/probe/RSV-3F9A1C7B')
        .set('X-Client', 'CC 1144093552');

      expect((await waitForRequestLog()).req?.client).toBe('INVALID');
    });
  });

  describe('niveles', () => {
    it('un error de negocio va con nivel warn y su errorCode, sin ninguna línea de error', async () => {
      await request(app.getHttpServer())
        .get('/api/probe/RSV-3F9A1C7B/unavailable')
        .expect(400);

      const log = await waitForRequestLog();
      expect(log.level).toBe(WARN);
      expect(log.res).toEqual({
        statusCode: 400,
        errorCode: 'NO_AVAILABILITY',
      });
      expect(lines().some((line) => line.level >= ERROR)).toBe(false);
    });

    it('una ruta inexistente va con nivel warn, sin patrón de ruta ni la URL', async () => {
      await request(app.getHttpServer())
        .get('/api/does-not-exist?search=1144093552')
        .expect(400);

      const log = await waitForRequestLog();
      expect(log.level).toBe(WARN);
      expect(log.route).toBeNull();
      expect(log.res?.errorCode).toBe('REQUEST_NOT_PROCESSED');
      expect(lines().some((line) => line.level >= ERROR)).toBe(false);
      expect(output.join('\n')).not.toContain('1144093552');
    });

    it('un error no controlado va con nivel error y su detalle, y la solicitud con warn', async () => {
      await request(app.getHttpServer())
        .get('/api/probe/RSV-3F9A1C7B/crash')
        .expect(400);

      const log = await waitForRequestLog();
      expect(log.level).toBe(WARN);
      const detail = lines().find((line) => line.level === ERROR);
      expect(JSON.stringify(detail)).toContain('connection refused');
    });
  });
});
