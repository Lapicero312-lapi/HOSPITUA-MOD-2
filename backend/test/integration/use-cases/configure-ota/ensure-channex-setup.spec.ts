import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  CHANNEX_PORT,
  type ChannexPort,
} from '../../../../src/application/ports/out/channex.port.js';
import {
  CONSULT_ROOM_INVENTORY,
  type ConsultRoomInventory,
} from '../../../../src/application/use-cases/consult-room-inventory/ports/in/consult-room-inventory.port.js';
import {
  ENSURE_CHANNEX_SETUP,
  type EnsureChannexSetup,
} from '../../../../src/application/use-cases/configure-ota/ports/in/ensure-channex-setup.port.js';
import { integrationEnv, truncateAllTables } from '../../support/database.js';

const PROPERTY_ID = '716305c4-561a-4561-a187-7f5b8aeb5920';

/** Los tipos que creó Channex simulado: A1 los devuelve, como el real. */
const createdTypes: { id: string; title: string; defaultOccupancy: number }[] =
  [];

/** Channex simulado: A0 con la propiedad configurada, y A1 y A2 para el paso 3 (T007). */
const channex = {
  listProperties: vi.fn(() =>
    Promise.resolve([{ id: PROPERTY_ID, title: 'Hotel de prueba' }]),
  ),
  listRoomTypes: vi.fn(() => Promise.resolve([...createdTypes])),
  createRoomType: vi.fn((input: { title: string; occupancy: number }) => {
    const created = {
      id: '994d1375-dbbd-4072-8724-b2ab32ce781b',
      title: input.title,
      defaultOccupancy: input.occupancy,
    };
    createdTypes.push(created);
    return Promise.resolve(created);
  }),
  updateRoomType: vi.fn(() => Promise.resolve()),
} as unknown as ChannexPort;

/** El Módulo 1 simulado: la 201, la 202 y la 203 de `DOBLE`, de 2 personas. */
const inventory = {
  listAll: vi.fn(() =>
    Promise.resolve(
      ['201', '202', '203'].map((roomNumber) => ({
        id: `00000000-0000-4000-8000-000000000${roomNumber}`,
        roomNumber,
        categoryRoom: 'DOBLE',
        maxCapacity: 2,
      })),
    ),
  ),
} as unknown as ConsultRoomInventory;

describe('EnsureChannexSetup con los módulos de Nest y PostgreSQL real', () => {
  let moduleRef: TestingModule;
  let setup: EnsureChannexSetup;
  let dataSource: DataSource;

  beforeAll(async () => {
    // Antes de importar los módulos: AppConfigModule lee el entorno al importarse. La clave es de
    // prueba y Channex está simulado: nunca se llama al real.
    Object.assign(process.env, {
      NODE_ENV: 'test',
      ...integrationEnv(),
      CHANNEX_API_KEY: 'clave-de-prueba',
      CHANNEX_PROPERTY_ID: PROPERTY_ID,
    });
    const { AppConfigModule } =
      await import('../../../../src/infrastructure/config/app-config.module.js');
    const { PersistenceModule } =
      await import('../../../../src/infrastructure/out/persistence/persistence.module.js');
    const { ClockModule } =
      await import('../../../../src/infrastructure/out/clock/clock.module.js');
    const { ChannexClientModule } =
      await import('../../../../src/infrastructure/out/channex/channex-client.module.js');
    const { Module1ClientModule } =
      await import('../../../../src/infrastructure/out/module1/module1-client.module.js');
    const { ConfigureOtaModule } =
      await import('../../../../src/application/use-cases/configure-ota/configure-ota.module.js');
    moduleRef = await Test.createTestingModule({
      imports: [
        AppConfigModule,
        PersistenceModule,
        ClockModule,
        ChannexClientModule,
        Module1ClientModule,
        ConfigureOtaModule,
      ],
    })
      .overrideProvider(CHANNEX_PORT)
      .useValue(channex)
      .overrideProvider(CONSULT_ROOM_INVENTORY)
      .useValue(inventory)
      .compile();
    moduleRef.useLogger(false);
    await moduleRef.init();
    setup = moduleRef.get(ENSURE_CHANNEX_SETUP);
    dataSource = moduleRef.get(DataSource);
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
  });

  afterAll(async () => {
    await moduleRef?.close();
    delete process.env.CHANNEX_API_KEY;
    delete process.env.CHANNEX_PROPERTY_ID;
  });

  it('con la propiedad verificada registra una sola agencia Booking.com, sin porcentaje, aunque se llame dos veces', async () => {
    await expect(setup.ensure()).resolves.toBe('READY');
    await expect(setup.ensure()).resolves.toBe('READY');

    const rows: {
      name: string;
      commission_percentage: string | null;
      connection_status: string;
    }[] = await dataSource.query(
      'SELECT name, commission_percentage, connection_status FROM ota',
    );
    expect(rows).toEqual([
      {
        name: 'Booking.com',
        commission_percentage: null,
        connection_status: 'CONNECTED',
      },
    ]);
  });

  it('paso 3: crea el tipo de cada categoría y guarda su relación con lo enviado; la segunda vez no cambia nada (T007)', async () => {
    vi.mocked(channex.createRoomType).mockClear();
    vi.mocked(channex.updateRoomType).mockClear();
    createdTypes.length = 0;

    await expect(setup.ensure()).resolves.toBe('READY');
    await expect(setup.ensure()).resolves.toBe('READY');

    const rows: {
      channex_room_type_id: string;
      category_room: string;
      count_of_rooms: number;
      occupancy: number;
    }[] = await dataSource.query(
      'SELECT channex_room_type_id, category_room, count_of_rooms, occupancy FROM ota_room_type_mapping',
    );
    expect(rows).toEqual([
      {
        channex_room_type_id: '994d1375-dbbd-4072-8724-b2ab32ce781b',
        category_room: 'DOBLE',
        count_of_rooms: 3,
        occupancy: 2,
      },
    ]);
    expect(channex.createRoomType).toHaveBeenCalledTimes(1);
    expect(channex.updateRoomType).not.toHaveBeenCalled();
  });
});
