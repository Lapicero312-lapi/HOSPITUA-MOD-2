import type { Writable } from 'node:stream';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { http, HttpResponse } from 'msw';
import type { SetupServer } from 'msw/node';
import { Logger, PARAMS_PROVIDER_TOKEN } from 'nestjs-pino';
import { vi } from 'vitest';
import type { Room } from '../../../src/application/integration/room.js';
import { CLOCK, type Clock } from '../../../src/application/ports/out/clock.js';
import { configureApp } from '../../../src/configure-app.js';
import { ChannexSetupJob } from '../../../src/infrastructure/in/jobs/channex-setup.job.js';
import { pinoHttpOptions } from '../../../src/infrastructure/shared/logging.options.js';
import { integrationEnv } from './database.js';

/** Channex y el Módulo 1 simulados. La clave es de prueba: nunca se llama al Channex real. */
export const CHANNEX_BASE_URL = 'http://channex.test';
export const MODULE1_BASE_URL = 'http://module1.test';
export const PROPERTY_ID = '716305c4-561a-4561-a187-7f5b8aeb5920';
export const CHANNEX_API_KEY = 'clave-de-prueba-9f3k2';

/** Los tipos de habitación de Channex de DOBLE y SUITE (las filas las crea la prueba: falta SyncRoomTypes). */
export const DOBLE_TYPE = '994d1375-dbbd-4072-8724-b2ab32ce781b';
export const SUITE_TYPE = '1e2d3c4b-5a69-4788-9a0b-1c2d3e4f5a6b';
export const BOOKING_ID = 'cfa33f3b-bd32-4b90-8ef9-bde2bfe986cd';

const room = (
  suffix: string,
  roomNumber: string,
  categoryRoom: string,
): Room => ({
  id: `1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c${suffix}`,
  roomNumber,
  categoryRoom,
  maxCapacity: 2,
});
export const ROOM_201 = room('01', '201', 'DOBLE');
export const ROOM_202 = room('02', '202', 'DOBLE');
export const ROOM_203 = room('03', '203', 'DOBLE');
export const SUITE_305 = room('05', '305', 'SUITE');

/** El titular de las revisiones: lo que no puede salir en un log. */
export const CUSTOMER = {
  name: 'Ximena',
  surname: 'Valderrama',
  mail: 'ximena.valderrama@correo.com',
  phone: '+57 311 222 3344',
  country: 'CO',
};

/** La revisión del ejemplo de A1 del plan, en el formato del feed de Channex. */
export const aRevision = (
  id: string,
  attributes: Record<string, unknown> = {},
  rooms: Record<string, unknown>[] = [{}],
) => ({
  type: 'booking_revision',
  id,
  attributes: {
    id,
    booking_id: BOOKING_ID,
    ota_reservation_code: '9996013801',
    ota_name: 'Booking.com',
    status: 'new',
    arrival_date: '2026-11-10',
    departure_date: '2026-11-12',
    amount: '220.00',
    ota_commission: '33.00',
    currency: 'USD',
    notes: 'Llegada tarde',
    customer: CUSTOMER,
    rooms: rooms.map((changes) => ({
      room_type_id: DOBLE_TYPE,
      rate_plan_id: '445835fb-7956-42ac-9efc-3e6f331f0808',
      checkin_date: '2026-11-10',
      checkout_date: '2026-11-12',
      occupancy: { adults: 2, children: 0, infants: 0 },
      ...changes,
    })),
    ...attributes,
  },
});

/** Lo que hace Channex simulado en la prueba; cada prueba lo cambia. */
export type SimulatedChannex = {
  /** Lo que trae el feed en la próxima lectura. */
  feed: unknown[];
  /** El estado con el que responde el feed (200 si no se cambia). */
  feedStatus: number;
  /** Cuántas veces se leyó el feed. */
  feedReads: number;
  /** Los `ack` que recibió, por id de revisión. */
  acks: string[];
  ackFails: boolean;
  /** Las habitaciones del Módulo 1. */
  module1Rooms: Room[];
};

export function aSimulatedChannex(): SimulatedChannex {
  return {
    feed: [],
    feedStatus: 200,
    feedReads: 0,
    acks: [],
    ackFails: false,
    module1Rooms: [ROOM_201, ROOM_202, ROOM_203, SUITE_305],
  };
}

/**
 * El entorno de las pruebas del feed: antes de importar `AppModule`, porque `AppConfigModule` lee el entorno
 * al importarse. El intervalo largo evita que la tarea corra sola: cada ciclo lo dispara la prueba.
 */
export function useBookingFeedEnv(): void {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    ...integrationEnv(),
    CHANNEX_BASE_URL,
    CHANNEX_API_KEY,
    CHANNEX_PROPERTY_ID: PROPERTY_ID,
    CHANNEX_SYNC_INTERVAL_SECONDS: '3600',
    MODULE1_BASE_URL,
  });
}

/** Las respuestas de Channex (A0, A1 y A2) y del Módulo 1, que leen `channex` en cada llamada. */
export function simulate(server: SetupServer, channex: SimulatedChannex) {
  server.use(
    http.get(`${CHANNEX_BASE_URL}/api/v1/properties/options`, () =>
      HttpResponse.json({
        data: [
          {
            type: 'property',
            id: PROPERTY_ID,
            attributes: { id: PROPERTY_ID, title: 'Hotel de prueba' },
          },
        ],
      }),
    ),
    http.get(`${CHANNEX_BASE_URL}/api/v1/booking_revisions/feed`, () => {
      channex.feedReads += 1;
      return channex.feedStatus === 200
        ? HttpResponse.json({
            meta: { total: channex.feed.length, page: 1, limit: 100 },
            data: channex.feed,
          })
        : HttpResponse.json({}, { status: channex.feedStatus });
    }),
    http.post(
      `${CHANNEX_BASE_URL}/api/v1/booking_revisions/:id/ack`,
      ({ params }) => {
        channex.acks.push(String(params.id));
        return channex.ackFails
          ? HttpResponse.json({}, { status: 503 })
          : HttpResponse.json({ data: {} });
      },
    ),
    // Como el Módulo 1, filtra por `categoryRoom` si viene en la consulta.
    http.get(`${MODULE1_BASE_URL}/api/rooms`, ({ request }) => {
      const category = new URL(request.url).searchParams.get('categoryRoom');
      return HttpResponse.json(
        channex.module1Rooms.filter(
          ({ categoryRoom }) => category === null || categoryRoom === category,
        ),
      );
    }),
    http.get(
      `${MODULE1_BASE_URL}/api/rooms/:roomId/maintenances`,
      ({ params }) =>
        HttpResponse.json({
          roomId: params.roomId,
          available: true,
          conflicts: [],
        }),
    ),
  );
}

/**
 * La aplicación completa con el reloj de la prueba, y la configuración de Channex ya lista (A0). Con
 * `logs`, escribe como en producción (pino), en el nivel más bajo y en ese destino.
 */
export async function startBookingFeedApp(
  clock: Clock,
  options: { logs?: Writable } = {},
): Promise<INestApplication> {
  const attempt = vi.spyOn(ChannexSetupJob.prototype, 'attempt');
  const { AppModule } = await import('../../../src/app.module.js');
  const builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(CLOCK)
    .useValue(clock);
  if (options.logs !== undefined) {
    builder
      .overrideProvider(PARAMS_PROVIDER_TOKEN)
      .useValue({ pinoHttp: [pinoHttpOptions('trace'), options.logs] });
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication(
    options.logs === undefined ? { logger: false } : { bufferLogs: true },
  );
  if (options.logs !== undefined) {
    app.useLogger(app.get(Logger));
  }
  configureApp(app);
  await app.init();
  const setup = await (attempt.mock.results[0]?.value as Promise<string>);
  attempt.mockRestore();
  if (setup !== 'READY') {
    throw new Error(`La configuración de Channex no quedó lista: ${setup}`);
  }
  return app;
}
