import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { http, HttpResponse } from 'msw';
import type { SetupServer } from 'msw/node';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { Room } from '../../../src/application/integration/room.js';
import { CLOCK, type Clock } from '../../../src/application/ports/out/clock.js';
import type { EnvironmentVariables } from '../../../src/infrastructure/config/env.validation.js';
import { CloseDayJob } from '../../../src/infrastructure/in/jobs/close-day.job.js';
import { integrationEnv } from './database.js';

/** Las habitaciones de `DOBLE`, de capacidad 2, de la 101 a la 103. */
const doble = (suffix: string, roomNumber: string): Room => ({
  id: `1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c${suffix}`,
  roomNumber,
  categoryRoom: 'DOBLE',
  maxCapacity: 2,
});
export const ROOM_101 = doble('01', '101');
export const ROOM_102 = doble('02', '102');
export const ROOM_103 = doble('03', '103');

/** Lo que cotiza el Módulo 3 por habitación y estadía, salvo que la prueba diga otra cosa. */
export const LODGING = '500000.00';

export const GUEST = {
  firstName: 'Valentina',
  lastName: 'Ospina',
  documentType: 'CC',
  documentNumber: '1144093552',
  nationality: 'Colombia',
  contactPhone: '+57 300 000 0000',
  contactEmail: 'valentina@correo.com',
};

/** El cuerpo de B: una habitación de 2 personas por cada `rooms`, con las tarifas de `LODGING`. */
export const aBody = (
  startDate: string,
  endDate: string,
  rooms: { guestCount: unknown; roomId?: string }[] = [{ guestCount: 2 }],
  changes: object = {},
) => ({
  startDate,
  endDate,
  categoryRoom: 'DOBLE',
  rooms,
  guest: GUEST,
  notes: null,
  expectedRates: rooms.map((_, index) => ({
    position: index + 1,
    lodgingAmount: LODGING,
    currency: 'COP',
  })),
  ...changes,
});

/** Una pausa: la llamada que la encuentra avisa con `reached` y espera a `release`. */
export type Gate = {
  reached: (count: number) => Promise<void>;
  arrive: () => void;
  opened: Promise<void>;
  release: () => void;
};

/** Una pausa que cuenta cuántas llamadas llegaron a ella. */
export function aGate(): Gate {
  let arrived = 0;
  const waiting: { count: number; resolve: () => void }[] = [];
  let release = () => {};
  const opened = new Promise<void>((resolve) => (release = resolve));
  return {
    arrive: () => {
      arrived += 1;
      for (const waiter of waiting.filter(({ count }) => arrived >= count)) {
        waiter.resolve();
      }
    },
    reached: (count) =>
      arrived >= count
        ? Promise.resolve()
        : new Promise((resolve) => waiting.push({ count, resolve })),
    opened,
    release,
  };
}

/** Lo que hacen y recibieron los Módulos 1 y 3 simulados; cada prueba lo cambia. */
export type SimulatedModules = {
  rooms: Room[];
  maintenanceCalls: number;
  quoteCalls: number;
  /** Lo que cotiza cada llamada del Módulo 3, por su número (1, 2…); `LODGING` si no está. */
  lodgingByCall: Record<number, string>;
  /** Las llamadas del Módulo 3 que responden 500. */
  failingCalls: number[];
  /** Si la hay, cada cotización espera en ella antes de responder. */
  quoteGate: Gate | null;
};

export function freshModules(): SimulatedModules {
  return {
    rooms: [ROOM_101, ROOM_102],
    maintenanceCalls: 0,
    quoteCalls: 0,
    lodgingByCall: {},
    failingCalls: [],
    quoteGate: null,
  };
}

/** Los Módulos 1 y 3 en HTTP, que leen `modules` en cada llamada. */
export function simulate(
  server: SetupServer,
  app: INestApplication,
  modules: SimulatedModules,
): void {
  const config =
    app.get<ConfigService<EnvironmentVariables, true>>(ConfigService);
  const module1 = config.get('MODULE1_BASE_URL', { infer: true });
  const module3 = config.get('MODULE3_BASE_URL', { infer: true });
  server.use(
    http.get(`${module1}/api/rooms`, () => HttpResponse.json(modules.rooms)),
    http.get(`${module1}/api/rooms/:roomId`, ({ params }) => {
      const room = modules.rooms.find(({ id }) => id === params.roomId);
      return room === undefined
        ? HttpResponse.json({ errorCode: 'ROOM_NOT_FOUND' }, { status: 404 })
        : HttpResponse.json(room);
    }),
    http.get(`${module1}/api/rooms/:roomId/maintenances`, ({ params }) => {
      modules.maintenanceCalls += 1;
      return HttpResponse.json({
        roomId: params.roomId,
        available: true,
        conflicts: [],
      });
    }),
    http.post(`${module3}/pricing/quotes`, async () => {
      modules.quoteCalls += 1;
      const call = modules.quoteCalls;
      const gate = modules.quoteGate;
      if (gate !== null) {
        gate.arrive();
        await gate.opened;
      }
      if (modules.failingCalls.includes(call)) {
        return HttpResponse.json({}, { status: 500 });
      }
      return HttpResponse.json({
        quoteId: `00000000-0000-4000-8000-${String(call).padStart(12, '0')}`,
        currency: 'COP',
        nightlyRates: [],
        lodgingAmount: modules.lodgingByCall[call] ?? LODGING,
      });
    }),
  );
}

/**
 * La aplicación completa (`AppModule`) con PostgreSQL y RabbitMQ reales y el reloj de la prueba. Los Módulos
 * 1 y 3 se simulan en HTTP con `simulate`.
 */
export async function startDirectReservationApp(
  clock: Clock,
): Promise<INestApplication<App>> {
  // AppConfigModule lee el entorno al importarse: AppModule se importa después de asignarlo.
  Object.assign(process.env, { NODE_ENV: 'test', ...integrationEnv() });
  const { AppModule } = await import('../../../src/app.module.js');
  const { configureApp } = await import('../../../src/configure-app.js');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(CLOCK)
    .useValue(clock)
    // Con el reloj fijo, el cierre del día no corre al arrancar: cerraría lo que guardaron otras pruebas.
    .overrideProvider(CloseDayJob)
    .useValue({})
    .compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>({
    logger: false,
  });
  configureApp(app);
  await app.init();
  return app;
}

/**
 * B: `POST /api/reservations/direct`, con una `Idempotency-Key` nueva por solicitud, como la pantalla (punto 15,
 * T019): dos solicitudes distintas nunca comparten la clave.
 */
export const createDirect = (app: INestApplication<App>, body: object) =>
  request(app.getHttpServer())
    .post('/api/reservations/direct')
    .set('Idempotency-Key', randomUUID())
    .send(body);
