import { randomUUID } from 'node:crypto';
import { createWriteStream, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import { HttpService } from '@nestjs/axios';
import type { INestApplication } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import axios from 'axios';
import { DateTime } from 'luxon';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { Logger, PARAMS_PROVIDER_TOKEN } from 'nestjs-pino';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Room } from '../../src/application/integration/room.js';
import {
  type AvailabilityRange,
  CHANNEX_PORT,
  type ChannexPort,
} from '../../src/application/ports/out/channex.port.js';
import { CLOCK, type Clock } from '../../src/application/ports/out/clock.js';
import { configureApp } from '../../src/configure-app.js';
import {
  groupRoomsByCategory,
  type RoomTypeGroup,
} from '../../src/domain/ota/channex-grouping.js';
import { AriDailyJob } from '../../src/infrastructure/in/jobs/ari-daily.job.js';
import { ChannexSetupJob } from '../../src/infrastructure/in/jobs/channex-setup.job.js';
import {
  CHANNEX_SYNC_INTERVAL,
  ChannexSyncJob,
} from '../../src/infrastructure/in/jobs/channex-sync.job.js';
import { ChannexHttpAdapter } from '../../src/infrastructure/out/channex/channex-http.adapter.js';
import { pinoHttpOptions } from '../../src/infrastructure/shared/logging.options.js';
import {
  integrationEnv,
  openTestDataSource,
  truncateAllTables,
} from '../integration/support/database.js';

/** El único Channex contra el que corre: una propiedad de producción no se toca. */
const STAGING_HOST = 'staging.channex.io';
/** El hotel de prueba de Booking conectado a la propiedad de staging (A0). */
const BOOKING_TEST_HOTEL = '10485037';
/** El Módulo 1 y el Módulo 3 están simulados: solo Channex es el real. */
const MODULE1_BASE_URL = 'http://module1.test';
const MODULE3_BASE_URL = 'http://module3.test';
/** Las habitaciones de la demo: las que informa su simulador del Módulo 1. */
const DEMO_ROOMS_FILE = resolve(
  import.meta.dirname,
  '../../../simulators/src/data.js',
);
/** La categoría de la reserva de prueba: SUITE tiene 3 habitaciones, como el ejemplo del spec. */
const CATEGORY = process.env.STAGING_ARI_CATEGORY ?? 'SUITE';
/** Cuánto espera, con la reserva hecha, a que quien corre la prueba la vea en Booking. */
const CHECK_MINUTES = Number(process.env.STAGING_CHECK_MINUTES ?? '5');
/** Las noches de la reserva se buscan desde 60 días adelante y dentro de los 90 que envía el Módulo 2. */
const FIRST_DAY = 60;
const LAST_DAY = 88;
/** Lo que cotiza el Módulo 3 simulado por la estadía. */
const LODGING = '500000.00';
/** El titular de la reserva de prueba: solo queda en la base de prueba, que se borra; a Channex no va. */
const TEST_GUEST = {
  firstName: 'Prueba',
  lastName: 'Staging',
  documentType: 'CC',
  documentNumber: '1000000000',
  nationality: 'Colombia',
  contactPhone: '+57 300 000 0000',
  contactEmail: 'prueba@hospitua.test',
};
/** El log de la aplicación (pino, como en producción: sin la clave), para revisar un paso que falla. */
const LOG_FILE = join(tmpdir(), 'hospitua-staging.log');

/**
 * Una variable de Channex como la lee la aplicación: la del sistema gana sobre las de `.env.test` y `.env`
 * (`AppConfigModule`). La prueba nunca la escribe en la salida.
 */
function channexSetting(name: string): string {
  const files = ['.env.test', '.env']
    .filter((file) => existsSync(file))
    .map((file) => parseEnv(readFileSync(file, 'utf8')));
  return (
    process.env[name] ||
    files
      .map((env) => env[name])
      .find((value) => value !== undefined && value !== '') ||
    ''
  );
}

const STAGING = {
  CHANNEX_BASE_URL:
    channexSetting('CHANNEX_BASE_URL') || `https://${STAGING_HOST}`,
  CHANNEX_API_KEY: channexSetting('CHANNEX_API_KEY'),
  CHANNEX_PROPERTY_ID: channexSetting('CHANNEX_PROPERTY_ID'),
};
const configured =
  STAGING.CHANNEX_API_KEY !== '' && STAGING.CHANNEX_PROPERTY_ID !== '';

/**
 * Lo que quien corre la prueba tiene que hacer, o lo que pasó. Va directo a la salida, en el momento:
 * Vitest no muestra el `console.log` de una prueba que pasa.
 */
const say = (text: string) => {
  process.stdout.write(`\n[staging] ${text}\n\n`);
};

const plusDays = (date: string, days: number): string =>
  DateTime.fromISO(date).plus({ days }).toISODate() ?? '';

/**
 * Una lectura de Channex staging para comprobar lo que quedó (no la hace el Módulo 2). Si falla, solo dice
 * el estado: el error de axios trae las cabeceras, con la clave.
 */
async function readChannex(
  path: string,
  params: Record<string, string> = {},
): Promise<unknown> {
  try {
    const { data } = await axios.get<unknown>(
      `${STAGING.CHANNEX_BASE_URL}${path}`,
      {
        params,
        headers: { 'user-api-key': STAGING.CHANNEX_API_KEY },
        timeout: 15_000,
      },
    );
    return data;
  } catch (error) {
    const status = axios.isAxiosError(error)
      ? (error.response?.status ?? 'sin respuesta')
      : 'error inesperado';
    throw new Error(`Channex staging respondió ${status} al leer ${path}.`);
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Un tipo de habitación como lo tiene Channex (`GET /api/v1/room_types/{id}`). */
async function roomTypeInChannex(id: string): Promise<Record<string, unknown>> {
  const body = await readChannex(`/api/v1/room_types/${id}`);
  const attributes =
    isObject(body) && isObject(body.data) ? body.data.attributes : undefined;
  if (!isObject(attributes)) {
    throw new Error(
      `Channex staging respondió el tipo de habitación ${id} sin sus atributos.`,
    );
  }
  return attributes;
}

/**
 * La disponibilidad de un tipo de habitación por noche, como la tiene Channex (`GET /api/v1/availability`).
 * Una noche sin valor es `0`, como nace un tipo de habitación.
 */
async function availabilityInChannex(
  roomTypeId: string,
  from: string,
  to: string,
): Promise<Record<string, number>> {
  const body = await readChannex('/api/v1/availability', {
    'filter[property_id]': STAGING.CHANNEX_PROPERTY_ID,
    'filter[date][gte]': from,
    'filter[date][lte]': to,
  });
  if (!isObject(body) || !isObject(body.data)) {
    throw new Error('Channex staging respondió la disponibilidad sin `data`.');
  }
  const byNight = body.data[roomTypeId];
  const nights: Record<string, number> = {};
  for (let night = from; night <= to; night = plusDays(night, 1)) {
    const value = isObject(byNight) ? byNight[night] : undefined;
    nights[night] = typeof value === 'number' ? value : 0;
  }
  return nights;
}

/** Las habitaciones que informa el simulador del Módulo 1 de la demo. */
async function demoRooms(): Promise<Room[]> {
  const loaded = (await import(pathToFileURL(DEMO_ROOMS_FILE).href)) as {
    ROOMS?: unknown;
  };
  const rooms = loaded.ROOMS;
  if (
    !Array.isArray(rooms) ||
    rooms.length === 0 ||
    !rooms.every(
      (room) =>
        isObject(room) &&
        typeof room.id === 'string' &&
        typeof room.roomNumber === 'string' &&
        typeof room.categoryRoom === 'string' &&
        typeof room.maxCapacity === 'number',
    )
  ) {
    throw new Error(
      `No se pudieron leer las habitaciones de la demo de ${DEMO_ROOMS_FILE}.`,
    );
  }
  return rooms as Room[];
}

/**
 * La aplicación completa, con su log en `LOG_FILE` y sin el envío de las 03:00 (`AriDailyJob`), que
 * mandaría 90 días a staging. `ChannexSyncJob` queda, pero sin su intervalo: cada ciclo lo dispara la
 * prueba, aunque la corrida dure más de una hora. Espera a que la configuración de Channex (A0) quede lista,
 * con los tipos de habitación ya sincronizados.
 */
async function startStagingApp(): Promise<INestApplication> {
  const attempt = vi.spyOn(ChannexSetupJob.prototype, 'attempt');
  const { AppModule } = await import('../../src/app.module.js');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(AriDailyJob)
    .useValue({})
    .overrideProvider(PARAMS_PROVIDER_TOKEN)
    .useValue({
      pinoHttp: [pinoHttpOptions('trace'), createWriteStream(LOG_FILE)],
    })
    .compile();
  const app = moduleRef.createNestApplication({ bufferLogs: true });
  app.useLogger(app.get(Logger));
  configureApp(app);
  await app.init();
  const scheduler = app.get(SchedulerRegistry);
  if (scheduler.doesExist('interval', CHANNEX_SYNC_INTERVAL)) {
    scheduler.deleteInterval(CHANNEX_SYNC_INTERVAL);
  }
  const setup = await (attempt.mock.results[0]?.value as Promise<string>);
  attempt.mockRestore();
  if (setup !== 'READY') {
    throw new Error(
      `La configuración de Channex staging no quedó lista (${setup}). El motivo está en ${LOG_FILE}.`,
    );
  }
  return app;
}

const module1Rooms: Room[] = [];
const server = setupServer(
  // Como el Módulo 1, filtra por `categoryRoom` si viene en la consulta.
  http.get(`${MODULE1_BASE_URL}/api/rooms`, ({ request: asked }) => {
    const category = new URL(asked.url).searchParams.get('categoryRoom');
    return HttpResponse.json(
      module1Rooms.filter(
        ({ categoryRoom }) => category === null || categoryRoom === category,
      ),
    );
  }),
  http.get(`${MODULE1_BASE_URL}/api/rooms/:roomId`, ({ params }) => {
    const room = module1Rooms.find(({ id }) => id === params.roomId);
    return room === undefined
      ? HttpResponse.json({ errorCode: 'ROOM_NOT_FOUND' }, { status: 404 })
      : HttpResponse.json(room);
  }),
  http.get(`${MODULE1_BASE_URL}/api/rooms/:roomId/maintenances`, ({ params }) =>
    HttpResponse.json({
      roomId: params.roomId,
      available: true,
      conflicts: [],
    }),
  ),
  http.post(`${MODULE3_BASE_URL}/pricing/quotes`, () =>
    HttpResponse.json({
      quoteId: randomUUID(),
      currency: 'COP',
      nightlyRates: [],
      lodgingAmount: LODGING,
    }),
  ),
);

/**
 * T013 de `configure-ota`: contra Channex staging, los tipos de habitación aparecen en la propiedad y la
 * disponibilidad llega al hotel de prueba de Booking. Revisa las pruebas independientes de las historias 2 y
 * 3 del spec: un tipo por categoría con su cantidad y su capacidad, con su relación guardada; y, en una
 * categoría de 3 habitaciones, una reserva directa de una habitación por dos noches deja la disponibilidad
 * en 2 esas noches, y su cancelación la devuelve a 3.
 *
 * Es una corrida guiada: `pnpm test:staging configure-ota` (Docker abierto) arranca la aplicación con
 * PostgreSQL y RabbitMQ de prueba, el Módulo 1 y el Módulo 3 simulados y el Channex de staging con la
 * configuración de quien la corre (las variables del sistema o `backend/.env`). Sin la clave o la propiedad
 * de Channex, se salta. Solo corre contra `staging.channex.io`.
 *
 * Antes de correrla, la demo (la única copia del Módulo 2 conectada a Channex) tiene que estar pausada y el
 * feed vacío: cada envío lee primero el feed. Si al empezar el feed tiene revisiones pendientes, son de la
 * demo: la prueba se detiene sin procesarlas ni confirmarlas.
 *
 * Para no cambiarle nada a la demo, el Módulo 1 simulado informa las mismas habitaciones que el simulador
 * de la demo (`simulators/src/data.js`): los tipos se crean o se adoptan con sus mismos valores. La reserva
 * usa dos noches desde 60 días adelante en las que Channex no muestra reservas de la demo para la categoría,
 * y solo se envían esas dos noches: al terminar quedan con todas las habitaciones libres. La parte de Booking
 * la revisa quien corre la prueba: la prueba no puede leer Booking.
 */
describe.skipIf(!configured)(
  'configure-ota contra Channex staging: los tipos de habitación en la propiedad y la disponibilidad en Booking (T013)',
  () => {
    let dataSource: DataSource;
    let app: INestApplication;
    let clock: Clock;
    let groups: RoomTypeGroup[];
    /** La categoría de la reserva de prueba y su tipo de habitación en Channex. */
    let target: RoomTypeGroup;
    let targetType: string | undefined;
    /** Cada envío de disponibilidad (A4) del Módulo 2, con los avisos de Channex. */
    const pushes: { values: AvailabilityRange[]; warnings: string[] }[] = [];
    /** La reserva de prueba mientras no se cancele, y sus dos noches. */
    let reserved: string | undefined;
    let nights: [string, string] | undefined;

    /** Un ciclo de la tarea de Channex: el feed y después la disponibilidad pendiente. */
    const cycle = async () => {
      await expect(app.get(ChannexSyncJob).run()).resolves.toBe(true);
    };

    const cancelReservation = async (reservationRef: string) => {
      const { body } = await request(app.getHttpServer())
        .get(`/api/reservations/${reservationRef}`)
        .set('X-Client', 'RECEPTIONIST')
        .expect(200);
      await request(app.getHttpServer())
        .post(`/api/reservations/${reservationRef}/cancellation`)
        .set('X-User', 'Prueba staging')
        .send({ updatedAt: body.updatedAt as string, acknowledged: true })
        .expect(200);
    };

    beforeAll(async () => {
      if (new URL(STAGING.CHANNEX_BASE_URL).hostname !== STAGING_HOST) {
        throw new Error(
          `La prueba solo corre contra ${STAGING_HOST}: CHANNEX_BASE_URL apunta a otro Channex.`,
        );
      }
      // Antes de importar AppModule: AppConfigModule lee el entorno al importarse.
      Object.assign(process.env, {
        NODE_ENV: 'test',
        ...integrationEnv(),
        ...STAGING,
        CHANNEX_SYNC_INTERVAL_SECONDS: '3600',
        MODULE1_BASE_URL,
        MODULE3_BASE_URL,
      });
      // Solo sale a la red lo que va a Channex staging; cualquier otra llamada sin simular falla.
      server.listen({
        onUnhandledRequest: (asked, print) => {
          if (new URL(asked.url).hostname !== STAGING_HOST) {
            print.error();
          }
        },
      });

      // Lo pendiente en el feed es de la demo: se detiene sin procesarlo ni confirmarlo.
      const { total: pending } = await new ChannexHttpAdapter(
        new HttpService(axios.create({ timeout: 15_000 })),
        {
          get: (name: string) => process.env[name],
        } as unknown as ConfigService,
      ).fetchBookingFeed(1);
      if (pending > 0) {
        throw new Error(
          `El feed de Channex staging tiene ${pending === 1 ? 'una revisión pendiente' : `${pending} revisiones pendientes`} de la demo. La prueba se detuvo sin procesar ni confirmar nada: deja que la demo termine, páusala y vuelve a correr la prueba con el feed vacío.`,
        );
      }
      say(
        'El feed de Channex staging está vacío. Mientras dure la prueba, la demo tiene que seguir pausada.',
      );

      module1Rooms.push(...(await demoRooms()));
      groups = groupRoomsByCategory(module1Rooms);
      const found = groups.find(
        ({ categoryRoom }) => categoryRoom === CATEGORY,
      );
      if (found === undefined) {
        throw new Error(
          `La categoría ${CATEGORY} no está entre las habitaciones de la demo (${groups.map(({ categoryRoom }) => categoryRoom).join(', ')}).`,
        );
      }
      target = found;

      dataSource = await openTestDataSource();
      await truncateAllTables(dataSource);
      app = await startStagingApp();
      clock = app.get<Clock>(CLOCK);
      const channex = app.get<ChannexPort>(CHANNEX_PORT);
      const push = channex.pushAvailability.bind(channex);
      vi.spyOn(channex, 'pushAvailability').mockImplementation(
        async (values) => {
          const result = await push(values);
          pushes.push({ values, warnings: result.warnings });
          return result;
        },
      );
    });

    afterAll(async () => {
      // Si la prueba se cortó con la reserva hecha, se cancela para devolver esas noches a Channex.
      if (reserved !== undefined) {
        try {
          await cancelReservation(reserved);
          await app.get(ChannexSyncJob).run();
          say(
            `La prueba se cortó con la reserva hecha: la cancelé y envié la disponibilidad de ${CATEGORY} otra vez.`,
          );
        } catch {
          say(
            `La prueba se cortó con la reserva hecha y no pude devolver la disponibilidad de ${CATEGORY} para las noches ${nights?.join(' y ') ?? ''}: revísala en Channex.`,
          );
        }
      }
      vi.restoreAllMocks();
      server.close();
      await app?.close();
      await dataSource?.destroy();
    });

    it('paso 1: cada categoría de la demo tiene su tipo de habitación en la propiedad, con su cantidad y su capacidad, y su relación guardada', async () => {
      const mappings: {
        channex_room_type_id: string;
        category_room: string;
        count_of_rooms: number;
        occupancy: number;
      }[] = await dataSource.query(
        `SELECT channex_room_type_id::text, category_room, count_of_rooms, occupancy
         FROM ota_room_type_mapping ORDER BY category_room`,
      );
      expect(mappings).toEqual(
        groups.map((group) => ({
          channex_room_type_id: expect.any(String) as string,
          category_room: group.categoryRoom,
          count_of_rooms: group.countOfRooms,
          occupancy: group.occupancy,
        })),
      );
      for (const mapping of mappings) {
        expect(
          await roomTypeInChannex(mapping.channex_room_type_id),
        ).toMatchObject({
          title: mapping.category_room,
          count_of_rooms: mapping.count_of_rooms,
          occ_adults: mapping.occupancy,
          default_occupancy: mapping.occupancy,
        });
      }
      targetType = mappings.find(
        ({ category_room }) => category_room === CATEGORY,
      )?.channex_room_type_id;
      say(
        `Paso 1 de 3: los tipos de habitación están en la propiedad de Channex staging: ${groups
          .map(
            (group) =>
              `${group.categoryRoom} (${group.countOfRooms} habitaciones, capacidad ${group.occupancy})`,
          )
          .join(', ')}.`,
      );
    });

    it(
      `paso 2: una reserva directa de una habitación de ${CATEGORY} por dos noches baja su disponibilidad en una habitación esas noches en Channex`,
      async () => {
        if (targetType === undefined) {
          throw new Error(`Falta el paso 1: ${CATEGORY} no tiene su tipo.`);
        }
        const rooms = target.countOfRooms;
        const today = clock.today();
        const shown = await availabilityInChannex(
          targetType,
          plusDays(today, FIRST_DAY),
          plusDays(today, LAST_DAY),
        );
        // Una noche sin reservas de la demo: todas libres, o 0 si nunca se envió.
        const free = (night: string) =>
          shown[night] === rooms || shown[night] === 0;
        let first: string | undefined;
        for (let day = FIRST_DAY; day < LAST_DAY; day += 1) {
          const night = plusDays(today, day);
          if (free(night) && free(plusDays(night, 1))) {
            first = night;
            break;
          }
        }
        if (first === undefined) {
          throw new Error(
            `No hay dos noches seguidas entre el ${plusDays(today, FIRST_DAY)} y el ${plusDays(today, LAST_DAY)} sin reservas de la demo para ${CATEGORY}.`,
          );
        }
        nights = [first, plusDays(first, 1)];
        const departure = plusDays(first, 2);

        const { body } = await request(app.getHttpServer())
          .post('/api/reservations/direct')
          .set('Idempotency-Key', randomUUID())
          .send({
            startDate: first,
            endDate: departure,
            categoryRoom: CATEGORY,
            rooms: [{ guestCount: 1 }],
            guest: TEST_GUEST,
            notes: null,
            expectedRates: [
              { position: 1, lodgingAmount: LODGING, currency: 'COP' },
            ],
          })
          .expect(201);
        reserved = body.reservationRef as string;
        pushes.length = 0;
        await cycle();

        expect(pushes).toEqual([
          {
            values: [
              {
                roomTypeId: targetType,
                dateFrom: nights[0],
                dateTo: nights[1],
                availability: rooms - 1,
              },
            ],
            warnings: [],
          },
        ]);
        expect(
          await availabilityInChannex(targetType, nights[0], nights[1]),
        ).toEqual({ [nights[0]]: rooms - 1, [nights[1]]: rooms - 1 });

        say(
          `Paso 2 de 3: reservé una habitación de ${CATEGORY} del ${first} al ${departure} y Channex ya tiene ${rooms - 1} de ${rooms} para las noches del ${nights[0]} y el ${nights[1]}. Revisa en el hotel ${BOOKING_TEST_HOTEL} de Booking que ${CATEGORY} muestre ${rooms - 1} esas noches. Si ${CATEGORY} no aparece en el hotel, no está mapeada: vuelve a correr la prueba con STAGING_ARI_CATEGORY y otra categoría de la demo. Espero ${CHECK_MINUTES} minutos y la cancelo.`,
        );
        await new Promise((done) => setTimeout(done, CHECK_MINUTES * 60_000));
      },
      CHECK_MINUTES * 60_000 + 120_000,
    );

    it(`paso 3: al cancelar la reserva, la disponibilidad de ${CATEGORY} vuelve a todas sus habitaciones esas noches en Channex`, async () => {
      if (
        reserved === undefined ||
        nights === undefined ||
        targetType === undefined
      ) {
        throw new Error('Falta el paso 2: no hay reserva que cancelar.');
      }
      const rooms = target.countOfRooms;
      await cancelReservation(reserved);
      reserved = undefined;
      pushes.length = 0;
      await cycle();

      expect(pushes).toEqual([
        {
          values: [
            {
              roomTypeId: targetType,
              dateFrom: nights[0],
              dateTo: nights[1],
              availability: rooms,
            },
          ],
          warnings: [],
        },
      ]);
      expect(
        await availabilityInChannex(targetType, nights[0], nights[1]),
      ).toEqual({ [nights[0]]: rooms, [nights[1]]: rooms });
      say(
        `Paso 3 de 3: cancelé la reserva y Channex volvió a ${rooms} de ${rooms} para ${CATEGORY} las noches del ${nights[0]} y el ${nights[1]}. Revisa en Booking que también vuelva a ${rooms}. Listo.`,
      );
    });
  },
);
