import type {
  ChannexPort,
  ChannexRoomType,
  ChannexRoomTypeInput,
} from '../../ports/out/channex.port.js';
import type { ConsultRoomInventory } from '../../ports/out/consult-room-inventory.port.js';
import type { OtaRoomTypeMappingRepository } from '../../ports/out/ota-room-type-mapping.repository.js';
import type { OtaRoomTypeMapping } from '../../../domain/ota/ota-room-type-mapping.js';
import {
  groupRoomsByCategory,
  type RoomTypeGroup,
} from '../../../domain/ota/group-rooms-by-category.js';

const MAX_ROOM_TYPES_PER_PROPERTY = 20;

type LogContext = Readonly<Record<string, string | number>>;

export interface SyncRoomTypesLogger {
  warn(message: string, context: LogContext): void;
  error(message: string, context: LogContext): void;
}

export interface SyncRoomTypesResult {
  createdRoomTypeIds: string[];
}

export class SyncRoomTypes {
  constructor(
    private readonly propertyId: string,
    private readonly roomInventory: ConsultRoomInventory,
    private readonly channex: ChannexPort,
    private readonly mappings: OtaRoomTypeMappingRepository,
    private readonly logger: SyncRoomTypesLogger,
  ) {}

  async execute(): Promise<SyncRoomTypesResult> {
    let rooms: Awaited<ReturnType<ConsultRoomInventory['listAll']>>;
    try {
      rooms = await this.roomInventory.listAll();
    } catch {
      this.logger.error(
        'No se pudo consultar el inventario del Módulo 1; se reintentará en la próxima sincronización.',
        { operation: 'list_room_inventory' },
      );
      throw new Error('No se pudo consultar el inventario del Módulo 1.');
    }

    const groups = groupRoomsByCategory(rooms);
    let roomTypes: ChannexRoomType[];
    let existingMappings: OtaRoomTypeMapping[];
    try {
      [roomTypes, existingMappings] = await Promise.all([
        this.channex.listRoomTypes(this.propertyId),
        this.mappings.findAll(),
      ]);
    } catch {
      this.logger.error(
        'No se pudieron cargar los tipos de Channex o sus relaciones; se reintentará en la próxima sincronización.',
        { operation: 'load_room_types_and_mappings' },
      );
      throw new Error(
        'No se pudieron cargar los tipos de habitación existentes.',
      );
    }

    const propertyRoomTypes = roomTypes.filter(
      (roomType) => roomType.propertyId === this.propertyId,
    );
    const mappingsByCategory = new Map(
      existingMappings.map((mapping) => [mapping.categoryRoom, mapping]),
    );
    const roomTypesByTitle = this.indexRoomTypesByTitle(propertyRoomTypes);
    const createdRoomTypeIds: string[] = [];
    let roomTypeCount = propertyRoomTypes.length;

    this.logCategoriesWithoutRooms(groups, existingMappings);

    for (const group of groups) {
      const mapping = mappingsByCategory.get(group.categoryRoom);
      if (mapping) {
        await this.updateIfChanged(mapping, group);
        continue;
      }

      const matchingRoomTypes = roomTypesByTitle.get(group.categoryRoom) ?? [];
      if (matchingRoomTypes.length > 0) {
        if (matchingRoomTypes.length > 1) {
          this.logger.warn(
            'Se encontraron tipos Channex duplicados para una categoría; se usará el primero.',
            {
              categoryRoom: group.categoryRoom,
              selectedRoomTypeId: matchingRoomTypes[0].id,
            },
          );
        }

        const existingRoomType = matchingRoomTypes[0];
        await this.mappings.upsert(
          this.toMapping(existingRoomType.id, group, existingRoomType),
        );
        continue;
      }

      if (roomTypeCount >= MAX_ROOM_TYPES_PER_PROPERTY) {
        this.logger.error(
          'No se creó el tipo de habitación porque la propiedad alcanzó el límite de Channex.',
          {
            categoryRoom: group.categoryRoom,
            roomTypeLimit: MAX_ROOM_TYPES_PER_PROPERTY,
          },
        );
        continue;
      }

      const input = this.toRoomTypeInput(group);
      let createdRoomType: { id: string };
      try {
        createdRoomType = await this.channex.createRoomType(input);
      } catch {
        this.logger.error(
          'No se pudo crear el tipo de habitación en Channex; se reintentará en la próxima sincronización.',
          { categoryRoom: group.categoryRoom, operation: 'create_room_type' },
        );
        throw new Error(
          `No se pudo crear el tipo Channex de la categoría ${group.categoryRoom}.`,
        );
      }

      await this.mappings.upsert(this.toMapping(createdRoomType.id, group));
      roomTypeCount += 1;
      createdRoomTypeIds.push(createdRoomType.id);
    }

    return { createdRoomTypeIds };
  }

  private indexRoomTypesByTitle(
    roomTypes: ChannexRoomType[],
  ): Map<string, ChannexRoomType[]> {
    const index = new Map<string, ChannexRoomType[]>();
    for (const roomType of roomTypes) {
      const matches = index.get(roomType.title) ?? [];
      matches.push(roomType);
      index.set(roomType.title, matches);
    }
    return index;
  }

  private async updateIfChanged(
    mapping: OtaRoomTypeMapping,
    group: RoomTypeGroup,
  ): Promise<void> {
    if (
      mapping.countOfRooms === group.countOfRooms &&
      mapping.occupancy === group.occupancy
    ) {
      return;
    }

    try {
      await this.channex.updateRoomType(
        mapping.channexRoomTypeId,
        this.toRoomTypeInput(group),
      );
    } catch {
      this.logger.error(
        'No se pudo actualizar el tipo de habitación en Channex; se reintentará en la próxima sincronización.',
        { categoryRoom: group.categoryRoom, operation: 'update_room_type' },
      );
      throw new Error(
        `No se pudo actualizar el tipo Channex de la categoría ${group.categoryRoom}.`,
      );
    }

    await this.mappings.upsert({
      ...mapping,
      countOfRooms: group.countOfRooms,
      occupancy: group.occupancy,
    });
  }

  private toRoomTypeInput(group: RoomTypeGroup): ChannexRoomTypeInput {
    return {
      propertyId: this.propertyId,
      title: group.categoryRoom,
      countOfRooms: group.countOfRooms,
      occAdults: group.occupancy,
      occChildren: 0,
      occInfants: 0,
      defaultOccupancy: group.occupancy,
      roomKind: 'room',
    };
  }

  private toMapping(
    channexRoomTypeId: string,
    group: RoomTypeGroup,
    existingRoomType?: ChannexRoomType,
  ): OtaRoomTypeMapping {
    return {
      channexRoomTypeId,
      categoryRoom: group.categoryRoom,
      countOfRooms: group.countOfRooms,
      occupancy: existingRoomType?.defaultOccupancy ?? group.occupancy,
    };
  }

  private logCategoriesWithoutRooms(
    groups: RoomTypeGroup[],
    mappings: OtaRoomTypeMapping[],
  ): void {
    const categoriesWithRooms = new Set(
      groups.map((group) => group.categoryRoom),
    );
    for (const mapping of mappings) {
      if (!categoriesWithRooms.has(mapping.categoryRoom)) {
        this.logger.warn(
          'La categoría ya no tiene habitaciones vendibles; se conserva el tipo Channex y debe revisarse su disponibilidad.',
          { categoryRoom: mapping.categoryRoom },
        );
      }
    }
  }
}
