import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { OtaRoomTypeMappingRepository } from '../../../../application/ports/out/ota-room-type-mapping.repository.js';
import type { OtaRoomTypeMapping } from '../../../../domain/ota/ota-room-type-mapping.js';
import { OtaRoomTypeMappingTable } from '../tables/ota-room-type-mapping.table.js';

/**
 * `OtaRoomTypeMappingRepository` sobre la tabla `ota_room_type_mapping` (la crea la migración base). El
 * `id` lo pone la base (`gen_random_uuid()`).
 */
@Injectable()
export class TypeOrmOtaRoomTypeMappingRepository implements OtaRoomTypeMappingRepository {
  constructor(private readonly dataSource: DataSource) {}

  async findByChannexRoomType(
    channexRoomTypeId: string,
  ): Promise<OtaRoomTypeMapping | null> {
    const row = await this.dataSource.manager.findOneBy(
      OtaRoomTypeMappingTable,
      { channexRoomTypeId },
    );
    return row ? toMapping(row) : null;
  }

  async findAll(): Promise<OtaRoomTypeMapping[]> {
    const rows = await this.dataSource.manager.find(OtaRoomTypeMappingTable, {
      order: { categoryRoom: 'ASC' },
    });
    return rows.map(toMapping);
  }

  async upsert(mapping: OtaRoomTypeMapping): Promise<void> {
    // La categoría no se toca en el UPDATE: renombrarla crea un tipo nuevo (punto 4 del plan).
    await this.dataSource.query(
      `INSERT INTO ota_room_type_mapping
         (channex_room_type_id, category_room, count_of_rooms, occupancy)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (channex_room_type_id) DO UPDATE
         SET count_of_rooms = EXCLUDED.count_of_rooms,
             occupancy = EXCLUDED.occupancy`,
      [
        mapping.channexRoomTypeId,
        mapping.categoryRoom,
        mapping.countOfRooms,
        mapping.occupancy,
      ],
    );
  }
}

function toMapping(row: OtaRoomTypeMappingTable): OtaRoomTypeMapping {
  return {
    channexRoomTypeId: row.channexRoomTypeId,
    categoryRoom: row.categoryRoom,
    countOfRooms: row.countOfRooms,
    occupancy: row.occupancy,
  };
}
