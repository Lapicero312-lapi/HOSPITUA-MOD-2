import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import {
  CHANNEX_SETUP_STATE,
  type ChannexSetupState,
} from '../../src/application/ports/out/channex-setup-state.js';
import { configureApp } from '../../src/configure-app.js';

describe('Módulo 2 (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('arranca con la base de datos y, sin clave de Channex, deja las tareas de Channex apagadas', () => {
    const state = app.get<ChannexSetupState>(CHANNEX_SETUP_STATE);

    expect(state.isDisabled()).toBe(true);
    expect(state.isReady()).toBe(false);
  });

  it('una ruta que no existe responde 400 REQUEST_NOT_PROCESSED con el cuerpo de error del plan base', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/does-not-exist')
      .expect(400);

    expect(res.body).toEqual({
      errorCode: 'REQUEST_NOT_PROCESSED',
      message: 'No fue posible procesar la solicitud.',
      timestamp: expect.any(String),
      path: '/api/does-not-exist',
    });
  });
});
