import type { Room } from '../../../../integration/room.js';

/** Símbolo con el que Nest inyecta el servicio en los demás casos de uso. */
export const CONSULT_ROOM_INVENTORY = Symbol('CONSULT_ROOM_INVENTORY');

/**
 * Consulta de solo lectura al inventario del Módulo 1 (plan, B). La usa "Verificar disponibilidades"
 * antes de cualquier reserva.
 */
export interface ConsultRoomInventory {
  /**
   * B1: la habitación `roomId`, sin estado y sin modificar ningún dato.
   * @throws BusinessError `INVALID_ROOM_ID` si el `roomId` no es un UUID (sin llamar al Módulo 1) o si el
   * Módulo 1 no reconoce o rechaza la habitación. Los demás errores de `Module1Port` salen tal cual.
   */
  byRoomId(roomId: string): Promise<Room>;

  /**
   * B2: todas las habitaciones de la categoría `categoryRoom`, sin filtrar por estado y sin modificar
   * ningún dato; `[]` si la categoría no tiene habitaciones.
   * @throws BusinessError `INVALID_CATEGORY` si la `categoryRoom` no tiene la forma acordada (sin llamar
   * al Módulo 1) o si el Módulo 1 la rechaza. Los demás errores de `Module1Port` salen tal cual.
   */
  byCategory(categoryRoom: string): Promise<Room[]>;
}
