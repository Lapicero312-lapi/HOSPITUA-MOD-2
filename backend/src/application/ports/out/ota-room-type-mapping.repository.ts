import type { OtaRoomTypeMapping } from '../../../domain/ota/ota-room-type-mapping.js';

/** Símbolo con el que Nest inyecta el repositorio (plan base, regla 4). */
export const OTA_ROOM_TYPE_MAPPING_REPOSITORY = Symbol(
  'OTA_ROOM_TYPE_MAPPING_REPOSITORY',
);

/**
 * Las relaciones de los tipos de habitación de Channex con las categorías (`configure-ota`, B). La llena
 * `SyncRoomTypes` (C1) y la lee `generate-ota-reservation` para saber la categoría de cada habitación.
 */
export interface OtaRoomTypeMappingRepository {
  /** La relación de ese tipo de Channex, o `null` si no tiene (paso 3 de B1 de `generate-ota-reservation`). */
  findByChannexRoomType(
    channexRoomTypeId: string,
  ): Promise<OtaRoomTypeMapping | null>;

  /** Todas las relaciones, por categoría. */
  findAll(): Promise<OtaRoomTypeMapping[]>;

  /**
   * C1: guarda la relación. Si el tipo ya tenía una, cambia solo su cantidad y su capacidad: la categoría
   * no cambia, porque renombrarla crea un tipo nuevo (punto 4 de "Puntos que este plan propone"). Si la
   * categoría tenía otro tipo (lo borraron a mano en Channex), su relación se reemplaza por esta.
   */
  upsert(mapping: OtaRoomTypeMapping): Promise<void>;
}
