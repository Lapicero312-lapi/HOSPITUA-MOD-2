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
import { CalculateDynamicRateService } from '../../src/application/use-cases/calculate-dynamic-rate/calculate-dynamic-rate.service.js';
import { CALCULATE_DYNAMIC_RATE } from '../../src/application/use-cases/calculate-dynamic-rate/ports/in/calculate-dynamic-rate.port.js';
import { VERIFY_AVAILABILITY } from '../../src/application/use-cases/check-room-availability/ports/in/verify-availability.port.js';
import { VerifyAvailabilityService } from '../../src/application/use-cases/check-room-availability/verify-availability.service.js';
import { RESERVATION_LOOKUP } from '../../src/application/use-cases/check-view-reservation/ports/in/reservation-lookup.port.js';
import { ReservationLookupService } from '../../src/application/use-cases/check-view-reservation/reservation-lookup.service.js';
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

  // Si AppModule dejara de importar el módulo de un caso de uso, su servicio no existiría en la aplicación
  // y los flujos de reserva no podrían usarlo (plan base, regla 4).
  it.each([
    ['VerifyAvailability', VERIFY_AVAILABILITY, VerifyAvailabilityService],
    [
      'CalculateDynamicRate',
      CALCULATE_DYNAMIC_RATE,
      CalculateDynamicRateService,
    ],
    ['ReservationLookup', RESERVATION_LOOKUP, ReservationLookupService],
  ] as const)(
    'AppModule conecta %s: la aplicación lo puede entregar',
    (_name, token, service) => {
      expect(app.get(token)).toBeInstanceOf(service);
    },
  );

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
