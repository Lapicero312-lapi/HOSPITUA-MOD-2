import { Controller, Get, Inject } from '@nestjs/common';
import {
  LIST_ROOMS_WITH_MAINTENANCE,
  type ListRoomsWithMaintenance,
  type RoomWithMaintenance,
} from '../../../application/use-cases/consult-room-inventory/ports/in/list-rooms-with-maintenance.port.js';

/** Una habitación de la respuesta de C1. */
type RoomItem = Pick<
  RoomWithMaintenance,
  'id' | 'roomNumber' | 'categoryRoom' | 'maxCapacity' | 'maintenance'
>;

/** La pantalla "Habitaciones" de la Recepcionista (plan de `consult-room-inventory`, C1). */
@Controller('rooms')
export class RoomsController {
  constructor(
    @Inject(LIST_ROOMS_WITH_MAINTENANCE)
    private readonly rooms: ListRoomsWithMaintenance,
  ) {}

  /**
   * C1, `GET /api/rooms`: todas las habitaciones vendibles con su mantenimiento próximo, ordenadas por
   * categoría y luego por número, sin paginar. Si falla el inventario, el filtro global responde 400
   * `INVENTORY_UNAVAILABLE`.
   */
  @Get()
  async list(): Promise<{ items: RoomItem[]; total: number }> {
    const items = (await this.rooms.execute()).map(toItem);
    return { items, total: items.length };
  }
}

/** Solo los campos de C1: si la habitación trajera otro dato, no sale (FR-006: sin estado de la habitación). */
function toItem(room: RoomWithMaintenance): RoomItem {
  return {
    id: room.id,
    roomNumber: room.roomNumber,
    categoryRoom: room.categoryRoom,
    maxCapacity: room.maxCapacity,
    maintenance: room.maintenance,
  };
}
