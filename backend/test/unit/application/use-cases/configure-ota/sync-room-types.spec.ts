import type {
  ChannexPort,
  ChannexRoomType,
} from '../../../../../src/application/ports/out/channex.port.js';
import type {
  ConsultRoomInventory,
  SellableRoom,
} from '../../../../../src/application/ports/out/consult-room-inventory.port.js';
import type { OtaRoomTypeMappingRepository } from '../../../../../src/application/ports/out/ota-room-type-mapping.repository.js';
import {
  SyncRoomTypes,
  type SyncRoomTypesLogger,
} from '../../../../../src/application/use-cases/configure-ota/sync-room-types.js';
import type { OtaRoomTypeMapping } from '../../../../../src/domain/ota/ota-room-type-mapping.js';

const PROPERTY_ID = 'property-1';

describe('SyncRoomTypes', () => {
  let listAll: ReturnType<typeof vi.fn<ConsultRoomInventory['listAll']>>;
  let listRoomTypes: ReturnType<typeof vi.fn<ChannexPort['listRoomTypes']>>;
  let createRoomType: ReturnType<typeof vi.fn<ChannexPort['createRoomType']>>;
  let updateRoomType: ReturnType<typeof vi.fn<ChannexPort['updateRoomType']>>;
  let findByChannexRoomType: ReturnType<
    typeof vi.fn<OtaRoomTypeMappingRepository['findByChannexRoomType']>
  >;
  let findAll: ReturnType<
    typeof vi.fn<OtaRoomTypeMappingRepository['findAll']>
  >;
  let upsert: ReturnType<typeof vi.fn<OtaRoomTypeMappingRepository['upsert']>>;
  let warn: ReturnType<typeof vi.fn<SyncRoomTypesLogger['warn']>>;
  let error: ReturnType<typeof vi.fn<SyncRoomTypesLogger['error']>>;
  let useCase: SyncRoomTypes;

  beforeEach(() => {
    listAll = vi.fn<ConsultRoomInventory['listAll']>();
    listRoomTypes = vi.fn<ChannexPort['listRoomTypes']>();
    createRoomType = vi.fn<ChannexPort['createRoomType']>();
    updateRoomType = vi.fn<ChannexPort['updateRoomType']>();
    findByChannexRoomType =
      vi.fn<OtaRoomTypeMappingRepository['findByChannexRoomType']>();
    findAll = vi.fn<OtaRoomTypeMappingRepository['findAll']>();
    upsert = vi.fn<OtaRoomTypeMappingRepository['upsert']>();
    warn = vi.fn<SyncRoomTypesLogger['warn']>();
    error = vi.fn<SyncRoomTypesLogger['error']>();

    listAll.mockResolvedValue([]);
    listRoomTypes.mockResolvedValue([]);
    createRoomType
      .mockResolvedValueOnce({ id: 'new-double' })
      .mockResolvedValueOnce({ id: 'new-suite' });
    updateRoomType.mockResolvedValue();
    findByChannexRoomType.mockResolvedValue(null);
    findAll.mockResolvedValue([]);
    upsert.mockResolvedValue();

    useCase = new SyncRoomTypes(
      PROPERTY_ID,
      { listAll },
      { listRoomTypes, createRoomType, updateRoomType },
      { findByChannexRoomType, findAll, upsert },
      { warn, error },
    );
  });

  it('groups rooms by category and creates one Channex type per category', async () => {
    listAll.mockResolvedValue([
      room('101', 'DOBLE', 2),
      room('102', 'DOBLE', 3),
      room('103', 'DOBLE', 2),
      room('201', 'SUITE', 4),
    ]);

    const result = await useCase.execute();

    expect(createRoomType).toHaveBeenNthCalledWith(1, {
      propertyId: PROPERTY_ID,
      title: 'DOBLE',
      countOfRooms: 3,
      occAdults: 3,
      occChildren: 0,
      occInfants: 0,
      defaultOccupancy: 3,
      roomKind: 'room',
    });
    expect(createRoomType).toHaveBeenNthCalledWith(2, {
      propertyId: PROPERTY_ID,
      title: 'SUITE',
      countOfRooms: 1,
      occAdults: 4,
      occChildren: 0,
      occInfants: 0,
      defaultOccupancy: 4,
      roomKind: 'room',
    });
    expect(upsert).toHaveBeenCalledWith({
      channexRoomTypeId: 'new-double',
      categoryRoom: 'DOBLE',
      countOfRooms: 3,
      occupancy: 3,
    });
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(result.createdRoomTypeIds).toEqual(['new-double', 'new-suite']);
  });

  it('updates a mapped room type when its count or capacity changes', async () => {
    const mapping = mappedRoomType('channex-double', 'DOBLE', 3, 2);
    listAll.mockResolvedValue([
      room('101', 'DOBLE', 2),
      room('102', 'DOBLE', 2),
      room('103', 'DOBLE', 2),
      room('104', 'DOBLE', 3),
    ]);
    findAll.mockResolvedValue([mapping]);

    await useCase.execute();

    expect(updateRoomType).toHaveBeenCalledWith('channex-double', {
      propertyId: PROPERTY_ID,
      title: 'DOBLE',
      countOfRooms: 4,
      occAdults: 3,
      occChildren: 0,
      occInfants: 0,
      defaultOccupancy: 3,
      roomKind: 'room',
    });
    expect(upsert).toHaveBeenCalledWith({
      ...mapping,
      countOfRooms: 4,
      occupancy: 3,
    });
  });

  it('adopts the first matching type from the configured property', async () => {
    const roomTypes: ChannexRoomType[] = [
      {
        id: 'other-property-type',
        propertyId: 'other-property',
        title: 'DOBLE',
        defaultOccupancy: 2,
      },
      {
        id: 'existing-double',
        propertyId: PROPERTY_ID,
        title: 'DOBLE',
        defaultOccupancy: 2,
      },
    ];
    listAll.mockResolvedValue([room('101', 'DOBLE', 2)]);
    listRoomTypes.mockResolvedValue(roomTypes);

    await useCase.execute();

    expect(createRoomType).not.toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledWith({
      channexRoomTypeId: 'existing-double',
      categoryRoom: 'DOBLE',
      countOfRooms: 1,
      occupancy: 2,
    });
  });

  it('does not modify a mapping whose category no longer has sellable rooms', async () => {
    const mapping = mappedRoomType('channex-double', 'DOBLE', 3, 2);
    findAll.mockResolvedValue([mapping]);

    await useCase.execute();

    expect(createRoomType).not.toHaveBeenCalled();
    expect(updateRoomType).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.any(String), {
      categoryRoom: 'DOBLE',
    });
  });

  it('does not mutate Channex when the inventory or room-type listing fails', async () => {
    listAll.mockRejectedValueOnce(new Error('Module 1 unavailable'));

    await expect(useCase.execute()).rejects.toThrow(
      'No se pudo consultar el inventario del Módulo 1.',
    );
    expect(listRoomTypes).not.toHaveBeenCalled();
    expect(createRoomType).not.toHaveBeenCalled();
    expect(updateRoomType).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.any(String), {
      operation: 'list_room_inventory',
    });

    listAll.mockResolvedValue([room('101', 'DOBLE', 2)]);
    listRoomTypes.mockRejectedValueOnce(new Error('Channex unavailable'));

    await expect(useCase.execute()).rejects.toThrow(
      'No se pudieron cargar los tipos de habitación existentes.',
    );
    expect(createRoomType).not.toHaveBeenCalled();
    expect(updateRoomType).not.toHaveBeenCalled();
  });

  it('does not create a type when the property already has 20 types', async () => {
    const roomTypes = Array.from({ length: 20 }, (_, index) => ({
      id: `room-type-${index}`,
      propertyId: PROPERTY_ID,
      title: `TYPE_${index}`,
      defaultOccupancy: 2,
    }));
    listAll.mockResolvedValue([room('101', 'DOBLE', 2)]);
    listRoomTypes.mockResolvedValue(roomTypes);

    await useCase.execute();

    expect(createRoomType).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.any(String), {
      categoryRoom: 'DOBLE',
      roomTypeLimit: 20,
    });
  });

  it('logs and propagates failed Channex writes without saving their mappings', async () => {
    const mapping = mappedRoomType('channex-double', 'DOBLE', 3, 2);
    listAll.mockResolvedValue([
      room('101', 'DOBLE', 2),
      room('102', 'DOBLE', 2),
      room('103', 'DOBLE', 2),
      room('104', 'DOBLE', 2),
      room('201', 'SUITE', 4),
    ]);
    findAll.mockResolvedValue([mapping]);
    updateRoomType.mockRejectedValueOnce(new Error('Channex update failed'));
    createRoomType.mockResolvedValue({ id: 'new-suite' });

    await expect(useCase.execute()).rejects.toThrow(
      'No se pudo actualizar el tipo Channex de la categoría DOBLE.',
    );

    expect(upsert).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledWith(expect.any(String), {
      categoryRoom: 'DOBLE',
      operation: 'update_room_type',
    });
    expect(createRoomType).not.toHaveBeenCalled();
  });
});

function room(
  id: string,
  categoryRoom: string,
  maxCapacity: number,
): SellableRoom {
  return { id, roomNumber: id, categoryRoom, maxCapacity };
}

function mappedRoomType(
  channexRoomTypeId: string,
  categoryRoom: string,
  countOfRooms: number,
  occupancy: number,
): OtaRoomTypeMapping {
  return { channexRoomTypeId, categoryRoom, countOfRooms, occupancy };
}
