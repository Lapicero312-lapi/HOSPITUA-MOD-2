import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { delay, http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Room } from '../../../src/application/integration/room.js';
import {
  VERIFY_AVAILABILITY,
  type VerifyAvailability,
} from '../../../src/application/use-cases/check-room-availability/ports/in/verify-availability.port.js';
import type { EnvironmentVariables } from '../../../src/infrastructure/config/env.validation.js';
import { integrationEnv, truncateAllTables } from '../support/database.js';

/**
 * Prueba de tiempo de `check-room-availability` (T016, NFR-001: "La verificación completa debe responder
 * en menos de 2 segundos en condiciones normales"). El dato es el del plan ("Pruebas por escenario"):
 * una categoría de 20 habitaciones con el Módulo 1 simulado a 150 ms responde en menos de 2 s.
 *
 * Todo es real salvo el Módulo 1: los módulos de Nest, el adaptador HTTP, la configuración (con el tope
 * `MAINTENANCE_CONCURRENCY` por defecto, 5) y PostgreSQL. El Módulo 1 se simula en HTTP (msw), y cada
 * respuesta, la del inventario y la de cada calendario, tarda 150 ms.
 */

const MODULE1_DELAY_MS = 150;
const ROOM_COUNT = 20;
const LIMIT_MS = 2000;

/** La estadía del ejemplo del DTO del plan (dos noches). */
const START = '2026-10-10';
const END = '2026-10-12';

/** 20 habitaciones `DOBLE`, de la 201 a la 220, con un `id` fijo por número. */
const ROOMS: Room[] = Array.from({ length: ROOM_COUNT }, (_, index) => {
  const number = 201 + index;
  return {
    id: `00000000-0000-4000-8000-000000000${number}`,
    roomNumber: String(number),
    categoryRoom: 'DOBLE',
    maxCapacity: 2,
  };
});

const server = setupServer();

describe('VerifyAvailability: tiempo de respuesta (T016, NFR-001)', () => {
  let moduleRef: TestingModule;
  let availability: VerifyAvailability;
  /** Las consultas al calendario de la última verificación, y cuántas hubo en curso a la vez como máximo. */
  const calendar = { requests: 0, running: 0, maxRunning: 0 };

  beforeAll(async () => {
    // AppConfigModule lee el entorno al importarse: los módulos se importan después de asignarlo.
    Object.assign(process.env, { NODE_ENV: 'test', ...integrationEnv() });
    const { AppConfigModule } =
      await import('../../../src/infrastructure/config/app-config.module.js');
    const { PersistenceModule } =
      await import('../../../src/infrastructure/out/persistence/persistence.module.js');
    const { ClockModule } =
      await import('../../../src/infrastructure/out/clock/clock.module.js');
    const { Module1ClientModule } =
      await import('../../../src/infrastructure/out/module1/module1-client.module.js');
    const { CheckRoomAvailabilityModule } =
      await import('../../../src/application/use-cases/check-room-availability/check-room-availability.module.js');
    moduleRef = await Test.createTestingModule({
      imports: [
        AppConfigModule,
        PersistenceModule,
        ClockModule,
        Module1ClientModule,
        CheckRoomAvailabilityModule,
      ],
    }).compile();
    availability = moduleRef.get<VerifyAvailability>(VERIFY_AVAILABILITY);
    await truncateAllTables(moduleRef.get(DataSource));

    const baseUrl = moduleRef
      .get<ConfigService<EnvironmentVariables, true>>(ConfigService)
      .get('MODULE1_BASE_URL', { infer: true });
    server.use(
      http.get(`${baseUrl}/api/rooms`, async () => {
        await delay(MODULE1_DELAY_MS);
        return HttpResponse.json(ROOMS);
      }),
      http.get(
        `${baseUrl}/api/rooms/:roomId/maintenances`,
        async ({ params }) => {
          calendar.requests += 1;
          calendar.running += 1;
          calendar.maxRunning = Math.max(calendar.maxRunning, calendar.running);
          await delay(MODULE1_DELAY_MS);
          calendar.running -= 1;
          return HttpResponse.json({
            roomId: params.roomId,
            available: true,
            conflicts: [],
          });
        },
      ),
    );
    server.listen({ onUnhandledRequest: 'error' });
  });

  afterAll(async () => {
    server.close();
    await moduleRef?.close();
  });

  it(`una categoría de ${ROOM_COUNT} habitaciones con el Módulo 1 a ${MODULE1_DELAY_MS} ms responde en menos de 2 s`, async () => {
    // Una verificación antes de medir: la primera conexión a la base y al Módulo 1 no es una "condición
    // normal" (NFR-001).
    await availability.check({
      startDate: START,
      endDate: END,
      categoryRoom: 'DOBLE',
    });
    Object.assign(calendar, { requests: 0, running: 0, maxRunning: 0 });

    const start = performance.now();
    const result = await availability.check({
      startDate: START,
      endDate: END,
      categoryRoom: 'DOBLE',
    });
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(LIMIT_MS);
    // Es la verificación completa: las 20 habitaciones, cada una con su consulta al calendario.
    expect(result.rooms).toHaveLength(ROOM_COUNT);
    expect(result.rooms.every(({ available }) => available)).toBe(true);
    expect(calendar.requests).toBe(ROOM_COUNT);
    // Lo que la hace rápida: las consultas van en paralelo, sin pasar el tope (T009).
    expect(calendar.maxRunning).toBeGreaterThan(1);
    expect(calendar.maxRunning).toBeLessThanOrEqual(5);
  });
});
