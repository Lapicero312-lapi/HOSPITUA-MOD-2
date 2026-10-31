import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Room } from '../../../../../src/application/integration/room.js';
import {
  MODULE1_PORT,
  type Module1Port,
} from '../../../../../src/application/ports/out/module1.port.js';
import { MAINTENANCE_CONCURRENCY } from '../../../../../src/application/use-cases/consult-room-inventory/ports/in/list-rooms-with-maintenance.port.js';
import { AppModule } from '../../../../../src/app.module.js';
import { configureApp } from '../../../../../src/configure-app.js';

/** La 201 y la 202 del ejemplo de C1 del plan. Los `id` son UUID cualesquiera. */
const ROOM_201: Room = {
  id: randomUUID(),
  roomNumber: '201',
  categoryRoom: 'DOBLE',
  maxCapacity: 2,
};
const ROOM_202: Room = {
  id: randomUUID(),
  roomNumber: '202',
  categoryRoom: 'DOBLE',
  maxCapacity: 3,
};

/** El Módulo 1 simulado: entrega la 202 antes que la 201 y ninguna tiene mantenimientos. */
const module1: Partial<Module1Port> = {
  listRooms: () => Promise.resolve([ROOM_202, ROOM_201]),
  getMaintenances: (roomId) =>
    Promise.resolve({ roomId, available: true, conflicts: [] }),
};

/**
 * La aplicación completa (`AppModule`) con el Módulo 1 simulado: comprueba que `GET /api/rooms` está
 * conectada con su caso de uso. Los escenarios de C1 los prueba la tarea #53.
 */
describe('GET /api/rooms (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MODULE1_PORT)
      .useValue(module1)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('responde 200 con las habitaciones ordenadas por categoría y número, y el total', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/rooms')
      .expect(200);

    const none = {
      status: 'NONE',
      maintenanceStart: null,
      maintenanceEnd: null,
    };
    expect(res.body).toEqual({
      items: [
        { ...ROOM_201, maintenance: none },
        { ...ROOM_202, maintenance: none },
      ],
      total: 2,
    });
  });

  it('el tope de consultas de mantenimiento sale de la configuración validada: 5, su valor por defecto', () => {
    expect(app.get(MAINTENANCE_CONCURRENCY)).toBe(5);
  });
});
