import { randomUUID } from 'node:crypto';
import { type INestApplication, Logger } from '@nestjs/common';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import type { DataSource } from 'typeorm';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { Room } from '../../../../src/application/integration/room.js';
import type { Clock } from '../../../../src/application/ports/out/clock.js';
import {
  aSimulatedChannex,
  CHANNEX_BASE_URL,
  MODULE1_BASE_URL,
  PROPERTY_ID,
  ROOM_201,
  ROOM_202,
  ROOM_203,
  type SimulatedChannex,
  simulate,
  startBookingFeedApp,
  SUITE_305,
  useBookingFeedEnv,
} from '../../support/booking-feed-app.js';
import {
  openTestDataSource,
  truncateAllTables,
} from '../../support/database.js';

/** La `SUITE` del *Independent Test* del spec: capacidad 4. */
const SUITE_FOR_4: Room = { ...SUITE_305, maxCapacity: 4 };

/** La habitación que el Módulo 1 suma a `DOBLE` en el escenario 2. */
const ROOM_204: Room = {
  id: '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c04',
  roomNumber: '204',
  categoryRoom: 'DOBLE',
  maxCapacity: 2,
};

/** El cuerpo de A2 y A3 (plan, A2). */
type RoomTypeBody = {
  room_type: {
    property_id: string;
    title: string;
    count_of_rooms: number;
    occ_adults: number;
    occ_children: number;
    occ_infants: number;
    default_occupancy: number;
    room_kind: string;
  };
};

/** Un tipo de habitación de la propiedad en Channex simulado. */
type StoredRoomType = { id: string; title: string; countOfRooms: number };

/** Los tipos de habitación de Channex (A1, A2 y A3): lo que tiene, lo que recibió y cómo responde. */
type SimulatedRoomTypes = {
  stored: StoredRoomType[];
  created: RoomTypeBody[];
  updated: { id: string; body: RoomTypeBody }[];
  deleted: string[];
  /** El estado con el que responden A1 y A3 (200 si no se cambia). */
  listStatus: number;
  updateStatus: number;
};

/**
 * T008 de `configure-ota`: los escenarios 1 a 4 de la historia 2 (tipos de habitación), con la aplicación
 * completa, PostgreSQL real, y el Módulo 1 y Channex simulados en HTTP (msw). Cada sincronización es un
 * arranque (B1, paso 3): el aviso E2 (T012b) y el envío de las 03:00 (T011) llaman a la misma
 * `SyncRoomTypes`. El Módulo 1 informa la 201, la 202 y la 203 de `DOBLE` (capacidad 2) y la 305 de
 * `SUITE` (capacidad 4), como en el *Independent Test* del spec.
 */
describe('configure-ota: tipos de habitación desde las habitaciones vendibles (T008, historia 2)', () => {
  const server = setupServer();
  let dataSource: DataSource;
  let app: INestApplication | undefined;
  let channex: SimulatedChannex;
  let roomTypes: SimulatedRoomTypes;
  let warnings: string[];
  /** El Módulo 1 responde 500 a la lista de habitaciones. */
  let module1Down: boolean;
  const clock: Clock = {
    now: () => new Date('2026-11-09T15:00:00.000Z'),
    today: () => '2026-11-09',
  };

  /** Una sincronización de tipos: arranca la aplicación (y cierra la anterior, si la hay). */
  const synchronize = async () => {
    await app?.close();
    app = await startBookingFeedApp(clock);
  };

  const mappings = (): Promise<
    {
      channex_room_type_id: string;
      category_room: string;
      count_of_rooms: number;
      occupancy: number;
    }[]
  > =>
    dataSource.query(
      `SELECT channex_room_type_id, category_room, count_of_rooms, occupancy
       FROM ota_room_type_mapping ORDER BY category_room`,
    );

  const idOf = (title: string): string => {
    const found = roomTypes.stored.find((type) => type.title === title);
    if (found === undefined) {
      throw new Error(`Channex no tiene el tipo ${title}`);
    }
    return found.id;
  };

  const aBody = (
    title: string,
    countOfRooms: number,
    occupancy: number,
  ): RoomTypeBody => ({
    room_type: {
      property_id: PROPERTY_ID,
      title,
      count_of_rooms: countOfRooms,
      occ_adults: occupancy,
      occ_children: 0,
      occ_infants: 0,
      default_occupancy: occupancy,
      room_kind: 'room',
    },
  });

  const asData = (type: StoredRoomType, occupancy: number) => ({
    type: 'room_type',
    id: type.id,
    attributes: {
      id: type.id,
      property_id: PROPERTY_ID,
      title: type.title,
      default_occupancy: occupancy,
    },
  });

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    useBookingFeedEnv();
    server.listen({ onUnhandledRequest: 'bypass' });
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    channex = aSimulatedChannex();
    channex.module1Rooms = [ROOM_201, ROOM_202, ROOM_203, SUITE_FOR_4];
    roomTypes = {
      stored: [],
      created: [],
      updated: [],
      deleted: [],
      listStatus: 200,
      updateStatus: 200,
    };
    module1Down = false;
    simulate(server, channex);
    server.use(
      // Sin respuesta (`undefined`), msw sigue con la del Módulo 1 de `simulate`.
      http.get(`${MODULE1_BASE_URL}/api/rooms`, () =>
        module1Down ? HttpResponse.json({}, { status: 500 }) : undefined,
      ),
      http.get(`${CHANNEX_BASE_URL}/api/v1/room_types/options`, () =>
        roomTypes.listStatus === 200
          ? HttpResponse.json({
              data: roomTypes.stored.map((type) => asData(type, 2)),
            })
          : HttpResponse.json({}, { status: roomTypes.listStatus }),
      ),
      http.post(
        `${CHANNEX_BASE_URL}/api/v1/room_types`,
        async ({ request }) => {
          const body = (await request.json()) as RoomTypeBody;
          roomTypes.created.push(body);
          const type = {
            id: randomUUID(),
            title: body.room_type.title,
            countOfRooms: body.room_type.count_of_rooms,
          };
          roomTypes.stored.push(type);
          return HttpResponse.json({
            data: asData(type, body.room_type.default_occupancy),
          });
        },
      ),
      http.put(
        `${CHANNEX_BASE_URL}/api/v1/room_types/:id`,
        async ({ request, params }) => {
          const body = (await request.json()) as RoomTypeBody;
          const id = String(params.id);
          roomTypes.updated.push({ id, body });
          if (roomTypes.updateStatus !== 200) {
            return HttpResponse.json({}, { status: roomTypes.updateStatus });
          }
          const type = roomTypes.stored.find((stored) => stored.id === id);
          if (type !== undefined) {
            type.countOfRooms = body.room_type.count_of_rooms;
          }
          return HttpResponse.json({ data: {} });
        },
      ),
      http.delete(`${CHANNEX_BASE_URL}/api/v1/room_types/:id`, ({ params }) => {
        roomTypes.deleted.push(String(params.id));
        return HttpResponse.json({});
      }),
    );
    warnings = [];
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(
      (message: unknown) => {
        warnings.push(String(message));
      },
    );
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
    server.resetHandlers();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    server.close();
    await truncateAllTables(dataSource);
    await dataSource.destroy();
  });

  it('escenario 1: sin tipos en Channex, crea "DOBLE" con 3 habitaciones y 2 adultos y "SUITE" con 1 y 4, y guarda sus relaciones', async () => {
    await synchronize();

    expect(roomTypes.created).toEqual([
      aBody('DOBLE', 3, 2),
      aBody('SUITE', 1, 4),
    ]);
    expect(roomTypes.updated).toEqual([]);
    expect(await mappings()).toEqual([
      {
        channex_room_type_id: idOf('DOBLE'),
        category_room: 'DOBLE',
        count_of_rooms: 3,
        occupancy: 2,
      },
      {
        channex_room_type_id: idOf('SUITE'),
        category_room: 'SUITE',
        count_of_rooms: 1,
        occupancy: 4,
      },
    ]);
  });

  it('escenario 2: el Módulo 1 informa 4 habitaciones de DOBLE: actualiza su tipo a 4 (A3) y la relación; SUITE no cambia', async () => {
    await synchronize();
    const doble = idOf('DOBLE');
    channex.module1Rooms = [...channex.module1Rooms, ROOM_204];

    await synchronize();

    expect(roomTypes.created).toHaveLength(2);
    expect(roomTypes.updated).toEqual([
      { id: doble, body: aBody('DOBLE', 4, 2) },
    ]);
    expect(await mappings()).toEqual([
      expect.objectContaining({
        channex_room_type_id: doble,
        category_room: 'DOBLE',
        count_of_rooms: 4,
      }),
      expect.objectContaining({ category_room: 'SUITE', count_of_rooms: 1 }),
    ]);
  });

  it('escenario 3: SUITE ya no tiene habitaciones vendibles: su tipo no se borra ni cambia, la relación se conserva y queda en el log para revisión', async () => {
    await synchronize();
    const suite = idOf('SUITE');
    channex.module1Rooms = [ROOM_201, ROOM_202, ROOM_203];

    await synchronize();

    expect(roomTypes.deleted).toEqual([]);
    expect(roomTypes.updated).toEqual([]);
    expect(roomTypes.created).toHaveLength(2);
    expect(roomTypes.stored).toContainEqual({
      id: suite,
      title: 'SUITE',
      countOfRooms: 1,
    });
    expect(await mappings()).toContainEqual({
      channex_room_type_id: suite,
      category_room: 'SUITE',
      count_of_rooms: 1,
      occupancy: 4,
    });
    expect(warnings).toContainEqual(
      expect.stringContaining(
        'La categoría SUITE ya no tiene habitaciones vendibles',
      ),
    );
  });

  it('escenario 4: el Módulo 1 no responde: nada cambia en Channex ni en las relaciones; la siguiente sincronización actualiza el tipo', async () => {
    await synchronize();
    channex.module1Rooms = [...channex.module1Rooms, ROOM_204];
    module1Down = true;

    await synchronize();

    expect(roomTypes.created).toHaveLength(2);
    expect(roomTypes.updated).toEqual([]);
    expect(await mappings()).toContainEqual(
      expect.objectContaining({ category_room: 'DOBLE', count_of_rooms: 3 }),
    );

    // El Módulo 1 vuelve: la misma sincronización que no pasó, ahora pasa.
    module1Down = false;
    await synchronize();

    expect(roomTypes.updated).toEqual([
      { id: idOf('DOBLE'), body: aBody('DOBLE', 4, 2) },
    ]);
    expect(await mappings()).toContainEqual(
      expect.objectContaining({ category_room: 'DOBLE', count_of_rooms: 4 }),
    );
  });

  it('escenario 4: Channex no responde a la lectura de tipos (A1): no crea ni actualiza nada; la siguiente sincronización los crea', async () => {
    roomTypes.listStatus = 503;

    await synchronize();

    expect(roomTypes.created).toEqual([]);
    expect(roomTypes.updated).toEqual([]);
    expect(await mappings()).toEqual([]);

    roomTypes.listStatus = 200;
    await synchronize();

    expect(roomTypes.created).toEqual([
      aBody('DOBLE', 3, 2),
      aBody('SUITE', 1, 4),
    ]);
    expect(await mappings()).toHaveLength(2);
  });

  it('escenario 4: Channex no responde a la actualización (A3): la relación conserva lo anterior; la siguiente sincronización la reintenta y la guarda', async () => {
    await synchronize();
    const doble = idOf('DOBLE');
    channex.module1Rooms = [...channex.module1Rooms, ROOM_204];
    roomTypes.updateStatus = 503;

    await synchronize();

    expect(roomTypes.updated).toEqual([
      { id: doble, body: aBody('DOBLE', 4, 2) },
    ]);
    expect(roomTypes.stored).toContainEqual({
      id: doble,
      title: 'DOBLE',
      countOfRooms: 3,
    });
    expect(await mappings()).toContainEqual(
      expect.objectContaining({ category_room: 'DOBLE', count_of_rooms: 3 }),
    );

    roomTypes.updateStatus = 200;
    await synchronize();

    expect(roomTypes.updated).toEqual([
      { id: doble, body: aBody('DOBLE', 4, 2) },
      { id: doble, body: aBody('DOBLE', 4, 2) },
    ]);
    expect(await mappings()).toContainEqual(
      expect.objectContaining({ category_room: 'DOBLE', count_of_rooms: 4 }),
    );
  });
});
