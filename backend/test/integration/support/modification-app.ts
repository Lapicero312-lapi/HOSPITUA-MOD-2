import { randomUUID } from 'node:crypto';
import type { Writable } from 'node:stream';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { Logger, PARAMS_PROVIDER_TOKEN } from 'nestjs-pino';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { DataSource } from 'typeorm';
import type { Room } from '../../../src/application/integration/room.js';
import { CLOCK, type Clock } from '../../../src/application/ports/out/clock.js';
import {
  RESERVATION_REPOSITORY,
  type ReservationRepository,
} from '../../../src/application/ports/out/reservation.repository.js';
import type { EnvironmentVariables } from '../../../src/infrastructure/config/env.validation.js';
import { CloseDayJob } from '../../../src/infrastructure/in/jobs/close-day.job.js';
import { pinoHttpOptions } from '../../../src/infrastructure/shared/logging.options.js';
import { ROOM_201, ROOM_202 } from '../../support/rooms.js';
import { integrationEnv } from './database.js';

/** La 203, de `DOBLE` y capacidad 2, como la 201: las dos habitaciones del escenario 11. */
export const ROOM_203: Room = {
  id: randomUUID(),
  roomNumber: '203',
  categoryRoom: 'DOBLE',
  maxCapacity: 2,
};

/** La 305, de otra categoría (`SUITE`): el cambio de categoría del escenario 1. */
export const SUITE_305: Room = {
  id: randomUUID(),
  roomNumber: '305',
  categoryRoom: 'SUITE',
  maxCapacity: 2,
};

/** Once habitaciones más, de la 501 a la 511: una reserva de más de 10. */
export const ELEVEN_ROOMS: Room[] = Array.from({ length: 11 }, (_, index) => ({
  id: randomUUID(),
  roomNumber: String(501 + index),
  categoryRoom: 'DOBLE',
  maxCapacity: 2,
}));

/** Todas las habitaciones que responde el Módulo 1 simulado; otro `roomId` responde 404. */
const MODULE1_ROOMS: Room[] = [
  ROOM_201,
  ROOM_202,
  ROOM_203,
  SUITE_305,
  ...ELEVEN_ROOMS,
];

/** Una pausa: la llamada que la encuentra avisa con `reached` y espera a `release`. */
export type Gate = {
  reached: Promise<void>;
  arrive: () => void;
  opened: Promise<void>;
  release: () => void;
};

export function aGate(): Gate {
  let arrive = () => {};
  let release = () => {};
  const reached = new Promise<void>((resolve) => (arrive = resolve));
  const opened = new Promise<void>((resolve) => (release = resolve));
  return { reached, arrive, opened, release };
}

/** Lo que hacen y lo que recibieron los Módulos 1 y 3 simulados; cada prueba lo cambia. */
export type SimulatedModules = {
  /** Cuántas veces se consultó la ficha de una habitación y su calendario de mantenimientos. */
  roomCalls: number;
  maintenanceCalls: number;
  /** El `roomType` de cada cotización pedida al Módulo 3, en su orden. */
  quotedTypes: string[];
  /** La tarifa por noche que cotiza el Módulo 3. */
  nightly: string;
  /** El Módulo 3 responde 500. */
  module3Down: boolean;
  /** Las cotizaciones que responden 500, por su número de llamada (1, 2…): una que falla entre otras. */
  failingQuoteCalls: number[];
  /** Si la hay, cada cotización espera en ella antes de responder. */
  quoteGate: Gate | null;
};

export type ModificationApp = {
  app: INestApplication<App>;
  dataSource: DataSource;
  reservations: ReservationRepository;
  modules: SimulatedModules;
  /** Cambia el día operativo (el `Clock`). */
  setToday: (day: string) => void;
  /** Vuelve a dejar los módulos simulados como al arrancar. */
  resetModules: () => void;
  close: () => Promise<void>;
};

/** Las noches de una estadía: de la entrada al día anterior a la salida. */
export function nightsOf(start: string, end: string): string[] {
  const nights: string[] = [];
  for (
    const day = new Date(`${start}T00:00:00Z`);
    day < new Date(`${end}T00:00:00Z`);
    day.setUTCDate(day.getUTCDate() + 1)
  ) {
    nights.push(day.toISOString().slice(0, 10));
  }
  return nights;
}

/** `date` corrida `days` días. */
export function plusDays(date: string, days: number): string {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

/**
 * La aplicación completa (`AppModule`) con PostgreSQL y RabbitMQ reales y el día operativo que diga la
 * prueba. Los Módulos 1 y 3 se simulan en HTTP (msw), así que sus clientes, sus topes de concurrencia y la
 * configuración son los reales. El cierre del día no corre al arrancar: con el reloj fijo cerraría lo que
 * guardaron otras pruebas.
 *
 * Sin `logs`, la aplicación no escribe nada. Con `logs`, escribe como en producción (pino), pero en el nivel
 * más bajo y en ese destino, para revisar lo que se escribe.
 */
export async function startModificationApp(
  today: string,
  options: { logs?: Writable } = {},
): Promise<ModificationApp> {
  // AppConfigModule lee el entorno al importarse: AppModule se importa después de asignarlo.
  Object.assign(process.env, { NODE_ENV: 'test', ...integrationEnv() });
  const { AppModule } = await import('../../../src/app.module.js');
  const { configureApp } = await import('../../../src/configure-app.js');

  let current = today;
  const clock: Clock = {
    today: () => current,
    now: () => new Date(`${current}T15:00:00.000Z`),
  };
  const fresh = (): SimulatedModules => ({
    roomCalls: 0,
    maintenanceCalls: 0,
    quotedTypes: [],
    nightly: '300000.00',
    module3Down: false,
    failingQuoteCalls: [],
    quoteGate: null,
  });
  const modules = fresh();

  // La aplicación completa también llama a Channex al arrancar, y esta prueba no lo simula.
  const server = setupServer();
  server.listen({ onUnhandledRequest: 'bypass' });
  const { logs } = options;
  const builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(CLOCK)
    .useValue(clock)
    .overrideProvider(CloseDayJob)
    .useValue({});
  if (logs !== undefined) {
    builder
      .overrideProvider(PARAMS_PROVIDER_TOKEN)
      .useValue({ pinoHttp: [pinoHttpOptions('trace'), logs] });
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>(
    logs === undefined ? { logger: false } : { bufferLogs: true },
  );
  if (logs !== undefined) {
    app.useLogger(app.get(Logger));
  }
  configureApp(app);
  await app.init();

  const config =
    app.get<ConfigService<EnvironmentVariables, true>>(ConfigService);
  const module1 = config.get('MODULE1_BASE_URL', { infer: true });
  const module3 = config.get('MODULE3_BASE_URL', { infer: true });
  server.use(
    // La lista de una categoría (la usa ApplyOtaChange): como el Módulo 1, filtra por `categoryRoom`.
    http.get(`${module1}/api/rooms`, ({ request: list }) => {
      modules.roomCalls += 1;
      const category = new URL(list.url).searchParams.get('categoryRoom');
      return HttpResponse.json(
        MODULE1_ROOMS.filter(
          ({ categoryRoom }) => category === null || categoryRoom === category,
        ),
      );
    }),
    http.get(`${module1}/api/rooms/:roomId`, ({ params }) => {
      modules.roomCalls += 1;
      const room = MODULE1_ROOMS.find(({ id }) => id === params.roomId);
      return room === undefined
        ? new HttpResponse(null, { status: 404 })
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
    http.post(`${module3}/pricing/quotes`, async ({ request: quote }) => {
      const { roomType, checkInDate, checkOutDate } = (await quote.json()) as {
        roomType: string;
        checkInDate: string;
        checkOutDate: string;
      };
      modules.quotedTypes.push(roomType);
      const call = modules.quotedTypes.length;
      const gate = modules.quoteGate;
      if (gate !== null) {
        gate.arrive();
        await gate.opened;
      }
      if (modules.module3Down || modules.failingQuoteCalls.includes(call)) {
        return new HttpResponse(null, { status: 500 });
      }
      const nights = nightsOf(checkInDate, checkOutDate);
      return HttpResponse.json({
        quoteId: randomUUID(),
        currency: 'COP',
        nightlyRates: nights.map((date) => ({ date, rate: modules.nightly })),
        lodgingAmount: (Number(modules.nightly) * nights.length).toFixed(2),
      });
    }),
  );

  return {
    app,
    dataSource: app.get(DataSource),
    reservations: app.get<ReservationRepository>(RESERVATION_REPOSITORY),
    modules,
    setToday: (day) => {
      current = day;
    },
    resetModules: () => Object.assign(modules, fresh()),
    close: async () => {
      await app.close();
      server.close();
    },
  };
}

/** Las llamadas HTTP de la modificación (B1 y B2) y del detalle (C3). */
export type ModificationHttp = {
  preview: (reservationRef: string, body: object) => request.Test;
  confirm: (reservationRef: string, body: object) => request.Test;
  detail: (reservationRef: string) => request.Test;
  previewAndConfirm: (
    reservationRef: string,
    body: object,
  ) => Promise<{ shown: request.Response; confirmed: request.Response }>;
};

/** Las llamadas HTTP de la modificación (B1 y B2) y del detalle (C3). */
export function modificationHttp(app: INestApplication<App>): ModificationHttp {
  const preview = (reservationRef: string, body: object) =>
    request(app.getHttpServer())
      .post(`/api/reservations/${reservationRef}/modification-preview`)
      .send(body);
  const confirm = (reservationRef: string, body: object) =>
    request(app.getHttpServer())
      .patch(`/api/reservations/${reservationRef}`)
      .send(body);
  const detail = (reservationRef: string) =>
    request(app.getHttpServer())
      .get(`/api/reservations/${reservationRef}`)
      .set('X-Client', 'RECEPTIONIST');

  /**
   * Lo que hace la pantalla: la vista previa y, con las tarifas que mostró, la confirmación. Devuelve las
   * dos respuestas; la de la confirmación, sea cual sea su código.
   */
  const previewAndConfirm = async (reservationRef: string, body: object) => {
    const shown = await preview(reservationRef, body).expect(200);
    const quotes = shown.body.quotes as {
      rooms: {
        key: string;
        lodgingAmount: { amount: string; currency: string };
      }[];
    } | null;
    const confirmed = await confirm(reservationRef, {
      ...body,
      expectedRates: (quotes?.rooms ?? []).map(({ key, lodgingAmount }) => ({
        roomId: key,
        lodgingAmount: lodgingAmount.amount,
        currency: lodgingAmount.currency,
      })),
    });
    return { shown, confirmed };
  };

  return { preview, confirm, detail, previewAndConfirm };
}
