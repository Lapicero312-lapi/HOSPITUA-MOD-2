import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { OtaRoomTypeMapping } from '../../../src/domain/ota/ota-room-type-mapping.js';
import { TypeOrmOtaRoomTypeMappingRepository } from '../../../src/infrastructure/out/persistence/repositories/ota-room-type-mapping.repository.js';
import { openTestDataSource, truncateAllTables } from '../support/database.js';

/** El tipo `DOBLE` de los ejemplos de A1 y A4 del plan de `configure-ota`. */
const DOBLE: OtaRoomTypeMapping = {
  channexRoomTypeId: '994d1375-dbbd-4072-8724-b2ab32ce781b',
  categoryRoom: 'DOBLE',
  countOfRooms: 3,
  occupancy: 2,
};
const SUITE: OtaRoomTypeMapping = {
  channexRoomTypeId: '2c7b5e0a-41f3-4d8e-9a16-5f0e3b7d2c81',
  categoryRoom: 'SUITE',
  countOfRooms: 1,
  occupancy: 4,
};
const FAMILIAR: OtaRoomTypeMapping = {
  channexRoomTypeId: 'a8e4d2f6-93c1-4b57-8e0d-6c2f1a9b7e34',
  categoryRoom: 'FAMILIAR',
  countOfRooms: 2,
  occupancy: 5,
};

describe('TypeOrmOtaRoomTypeMappingRepository contra PostgreSQL real', () => {
  let dataSource: DataSource;
  let mappings: TypeOrmOtaRoomTypeMappingRepository;

  /** Las filas tal como las guardó la base. */
  const rows = async () =>
    dataSource.query<{ channex_room_type_id: string; category_room: string }[]>(
      'SELECT channex_room_type_id, category_room FROM ota_room_type_mapping',
    );

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    mappings = new TypeOrmOtaRoomTypeMappingRepository(dataSource);
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('sin relaciones: un tipo de Channex no tiene categoría y la lista está vacía', async () => {
    expect(
      await mappings.findByChannexRoomType(DOBLE.channexRoomTypeId),
    ).toBeNull();
    expect(await mappings.findAll()).toEqual([]);
  });

  it('guarda una relación nueva y la encuentra por su tipo de Channex', async () => {
    await mappings.upsert(DOBLE);

    expect(
      await mappings.findByChannexRoomType(DOBLE.channexRoomTypeId),
    ).toEqual(DOBLE);
  });

  it('un tipo de Channex distinto no encuentra la relación de otro', async () => {
    await mappings.upsert(DOBLE);

    expect(
      await mappings.findByChannexRoomType(SUITE.channexRoomTypeId),
    ).toBeNull();
  });

  it('con el tipo ya relacionado, cambia su cantidad y su capacidad sin crear otra fila', async () => {
    await mappings.upsert(DOBLE);

    await mappings.upsert({ ...DOBLE, countOfRooms: 4, occupancy: 3 });

    expect(await mappings.findAll()).toEqual([
      { ...DOBLE, countOfRooms: 4, occupancy: 3 },
    ]);
  });

  it('con el tipo ya relacionado, no cambia su categoría: renombrarla crea un tipo nuevo (punto 4)', async () => {
    await mappings.upsert(DOBLE);

    await mappings.upsert({ ...DOBLE, categoryRoom: 'DOBLE SUPERIOR' });

    expect(await rows()).toEqual([
      { channex_room_type_id: DOBLE.channexRoomTypeId, category_room: 'DOBLE' },
    ]);
  });

  it('cambiar un tipo no toca los demás', async () => {
    await mappings.upsert(DOBLE);
    await mappings.upsert(SUITE);

    await mappings.upsert({ ...DOBLE, countOfRooms: 4 });

    expect(
      await mappings.findByChannexRoomType(SUITE.channexRoomTypeId),
    ).toEqual(SUITE);
  });

  it('devuelve todas las relaciones por categoría', async () => {
    await mappings.upsert(SUITE);
    await mappings.upsert(DOBLE);
    await mappings.upsert(FAMILIAR);

    expect(await mappings.findAll()).toEqual([DOBLE, FAMILIAR, SUITE]);
  });

  it('otro tipo de Channex para una categoría que ya tiene uno reemplaza su relación (el anterior se borró a mano)', async () => {
    await mappings.upsert(DOBLE);
    await mappings.upsert(SUITE);
    const replacement = {
      ...DOBLE,
      channexRoomTypeId: '5d1f0b7e-2a4c-4e9b-8f63-0c7a1e4d9b52',
      countOfRooms: 4,
    };

    await mappings.upsert(replacement);

    expect(await mappings.findAll()).toEqual([replacement, SUITE]);
    expect(
      await mappings.findByChannexRoomType(DOBLE.channexRoomTypeId),
    ).toBeNull();
  });
});
