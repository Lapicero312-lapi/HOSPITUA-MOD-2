import { Controller, Get, type INestApplication, Post } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterEach, describe, expect, it } from 'vitest';
import { validateEnv } from '../../src/infrastructure/config/env.validation.js';
import {
  InternalKeyGuard,
  MODULE2_INTERNAL_KEY,
  RequiresInternalKey,
} from '../../src/infrastructure/in/rest/internal-key.guard.js';
import { ApiErrorFilter } from '../../src/infrastructure/shared/api-error.filter.js';
import { captureLogs } from '../integration/support/capture-logs.js';

/**
 * `X-Internal-Key` que el Módulo 2 exige a los Módulos 1 y 3 (plan base, "Configuración del Módulo 2" y
 * regla 10). El guard y el filtro de errores son los reales; las rutas son de prueba, marcadas como las de
 * `GET /api/reservations` (solo con `X-Client: MODULE1`) y las de comisiones (a todo el que llama). No
 * necesita Docker.
 */

/** Reconocible y larga: si aparece en algún texto, la prueba falla. */
const INTERNAL_KEY = 'ik-prueba-M2-0123456789-abcdefghij';

@Controller('probe')
class ProbeController {
  @Get('shared')
  @RequiresInternalKey(['MODULE1'])
  shared() {
    return { ok: true };
  }

  @Post('module3-only')
  @RequiresInternalKey()
  module3Only() {
    return { ok: true };
  }

  @Get('open')
  open() {
    return { ok: true };
  }
}

async function appWith(
  internalKey: string | null,
): Promise<INestApplication<App>> {
  const moduleRef = await Test.createTestingModule({
    controllers: [ProbeController],
    providers: [
      { provide: APP_FILTER, useClass: ApiErrorFilter },
      { provide: MODULE2_INTERNAL_KEY, useValue: internalKey },
      { provide: APP_GUARD, useClass: InternalKeyGuard },
    ],
  }).compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>({
    logger: false,
  });
  await app.init();
  return app;
}

describe('X-Internal-Key en las rutas del Módulo 2', () => {
  let app: INestApplication<App> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  describe('con la clave configurada', () => {
    it('una ruta de un solo llamador sin la clave responde 401 INVALID_INTERNAL_KEY con la forma de los errores', async () => {
      app = await appWith(INTERNAL_KEY);

      const res = await request(app.getHttpServer())
        .post('/probe/module3-only')
        .expect(401);

      expect(res.body).toEqual({
        errorCode: 'INVALID_INTERNAL_KEY',
        message: 'Falta la clave interna o no es válida.',
        timestamp: expect.any(String) as string,
        path: '/probe/module3-only',
      });
    });

    it.each([
      ['otra clave', 'otra-clave'],
      ['la clave con un carácter de más', `${INTERNAL_KEY}x`],
      ['la clave vacía', ''],
    ])('con %s responde 401', async (_name, given) => {
      app = await appWith(INTERNAL_KEY);

      await request(app.getHttpServer())
        .post('/probe/module3-only')
        .set('X-Internal-Key', given)
        .expect(401);
    });

    it('con la clave correcta deja pasar', async () => {
      app = await appWith(INTERNAL_KEY);

      await request(app.getHttpServer())
        .post('/probe/module3-only')
        .set('X-Internal-Key', INTERNAL_KEY)
        .expect(201, { ok: true });
    });

    it('en una ruta compartida, la exige solo con el X-Client marcado (MODULE1)', async () => {
      app = await appWith(INTERNAL_KEY);
      const server = app.getHttpServer();

      await request(server)
        .get('/probe/shared')
        .set('X-Client', 'MODULE1')
        .expect(401);
      await request(server)
        .get('/probe/shared')
        .set('X-Client', 'MODULE1')
        .set('X-Internal-Key', INTERNAL_KEY)
        .expect(200);
      // La Recepcionista llama desde el navegador, que no puede guardar la clave.
      await request(server)
        .get('/probe/shared')
        .set('X-Client', 'RECEPTIONIST')
        .expect(200);
      // Sin X-Client, la ruta responde su propio 400 INVALID_CLIENT (aquí, la ruta de prueba no lo revisa).
      await request(server).get('/probe/shared').expect(200);
    });

    it('una ruta sin marcar no la exige', async () => {
      app = await appWith(INTERNAL_KEY);

      await request(app.getHttpServer()).get('/probe/open').expect(200);
    });

    it('la clave no sale en la respuesta ni en los logs', async () => {
      const logs = captureLogs();
      app = await appWith(INTERNAL_KEY);

      const res = await request(app.getHttpServer())
        .post('/probe/module3-only')
        .set('X-Internal-Key', `${INTERNAL_KEY}-mal`)
        .expect(401);

      const output = [...logs, JSON.stringify(res.body), res.text].join('\n');
      expect(output).not.toContain(INTERNAL_KEY.replace('ik-prueba-', ''));
    });
  });

  it.each([
    ['sin clave configurada', null],
    ['con la clave vacía', ''],
  ])('%s no exige nada', async (_name, internalKey) => {
    app = await appWith(internalKey);

    await request(app.getHttpServer()).post('/probe/module3-only').expect(201);
  });

  describe('la validación del entorno', () => {
    const base = { NODE_ENV: 'test', LOG_LEVEL: 'silent' };

    it('acepta la variable ausente, vacía o con una clave válida', () => {
      expect(() => validateEnv({ ...base })).not.toThrow();
      expect(() =>
        validateEnv({ ...base, MODULE2_INTERNAL_KEY: '' }),
      ).not.toThrow();
      expect(
        validateEnv({ ...base, MODULE2_INTERNAL_KEY: INTERNAL_KEY })
          .MODULE2_INTERNAL_KEY,
      ).toBe(INTERNAL_KEY);
    });

    it('rechaza una clave con espacios sin repetirla en el mensaje', () => {
      let message = '';
      try {
        validateEnv({ ...base, MODULE2_INTERNAL_KEY: `${INTERNAL_KEY} x` });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain('MODULE2_INTERNAL_KEY');
      expect(message).not.toContain(INTERNAL_KEY);
    });
  });
});
