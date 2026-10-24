import { Controller, Get, INestApplication, Post } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { configureApp } from '../../../../../src/configure-app.js';
import {
  ClientHeader,
  UserHeader,
} from '../../../../../src/infrastructure/in/rest/request-headers.js';
import { ApiErrorFilter } from '../../../../../src/infrastructure/shared/api-error.filter.js';
import type { Client } from '../../../../../src/infrastructure/shared/clients.js';

/** Una ruta que admite a la Recepcionista y al Módulo 1, y otra que guarda quién hace la acción. */
@Controller('probe')
class ProbeController {
  @Get('reservations')
  list(@ClientHeader(['RECEPTIONIST', 'MODULE1']) client: Client) {
    return { client };
  }

  @Post('cancellation')
  cancel(
    @ClientHeader(['RECEPTIONIST']) client: Client,
    @UserHeader() processedBy: string,
  ) {
    return { client, processedBy };
  }
}

describe('Cabeceras X-Client y X-User', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController],
      providers: [{ provide: APP_FILTER, useClass: ApiErrorFilter }],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const server = () => request(app.getHttpServer());

  describe('X-Client', () => {
    it('la ruta recibe el llamador que admite', async () => {
      const res = await server()
        .get('/api/probe/reservations')
        .set('X-Client', 'MODULE1')
        .expect(200);

      expect(res.body).toEqual({ client: 'MODULE1' });
    });

    it.each([
      ['sin X-Client', undefined],
      ['con un llamador que la ruta no admite', 'MODULE3'],
      ['con un valor desconocido', 'OTA'],
    ])(
      '%s responde 400 INVALID_CLIENT con el cuerpo de error del plan',
      async (_, client) => {
        const call = server().get('/api/probe/reservations');
        const res = await (client ? call.set('X-Client', client) : call).expect(
          400,
        );

        expect(res.body).toEqual({
          errorCode: 'INVALID_CLIENT',
          message: 'La ruta no admite el cliente indicado en X-Client.',
          timestamp: expect.any(String),
          path: '/api/probe/reservations',
        });
      },
    );
  });

  describe('X-User', () => {
    it('la ruta recibe el usuario tal cual', async () => {
      const res = await server()
        .post('/api/probe/cancellation')
        .set('X-Client', 'RECEPTIONIST')
        .set('X-User', 'Laura Méndez')
        .expect(201);

      expect(res.body).toEqual({
        client: 'RECEPTIONIST',
        processedBy: 'Laura Méndez',
      });
    });

    it.each([
      ['sin X-User', undefined],
      ['con X-User vacío', '  '],
    ])('%s responde 400 USER_REQUIRED', async (_, user) => {
      const call = server()
        .post('/api/probe/cancellation')
        .set('X-Client', 'RECEPTIONIST');
      const res = await (user === undefined ? call : call.set('X-User', user));

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        errorCode: 'USER_REQUIRED',
        message: 'Falta el usuario que hace la acción.',
      });
    });

    it('con más de 100 caracteres responde 400 INVALID_USER', async () => {
      const res = await server()
        .post('/api/probe/cancellation')
        .set('X-Client', 'RECEPTIONIST')
        .set('X-User', 'a'.repeat(101))
        .expect(400);

      expect(res.body.errorCode).toBe('INVALID_USER');
    });
  });
});
