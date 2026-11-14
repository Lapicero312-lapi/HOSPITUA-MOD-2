import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Tabla `ota_room_type_mapping`, la relación de los tipos de habitación de Channex con las categorías
 * (plan base). El esquema lo crean las migraciones, no esta clase (D11).
 */
@Entity({ name: 'ota_room_type_mapping' })
export class OtaRoomTypeMappingTable {
  /** Lo pone la base al insertar (`DEFAULT gen_random_uuid()`). */
  @PrimaryColumn({ type: 'uuid' })
  id: string;

  @Column({ name: 'channex_room_type_id', type: 'uuid' })
  channexRoomTypeId: string;

  @Column({ name: 'category_room', type: 'varchar', length: 50 })
  categoryRoom: string;

  @Column({ name: 'count_of_rooms', type: 'integer' })
  countOfRooms: number;

  @Column({ type: 'smallint' })
  occupancy: number;
}
