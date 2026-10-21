import type { OtaRoomTypeMapping } from '../../../domain/ota/ota-room-type-mapping.js';

export interface OtaRoomTypeMappingRepository {
  findByChannexRoomType(
    channexRoomTypeId: string,
  ): Promise<OtaRoomTypeMapping | null>;
  findAll(): Promise<OtaRoomTypeMapping[]>;
  upsert(mapping: OtaRoomTypeMapping): Promise<void>;
}
