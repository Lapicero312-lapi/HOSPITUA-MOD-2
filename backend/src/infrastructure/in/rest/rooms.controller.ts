import { Controller, Get, Inject } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
} from '@nestjs/swagger';
import {
  LIST_ROOMS_WITH_MAINTENANCE,
  type ListRoomsWithMaintenance,
  type RoomWithMaintenance,
} from '../../../application/use-cases/consult-room-inventory/ports/in/list-rooms-with-maintenance.port.js';
import { ApiErrorBody } from '../../shared/api-error.js';
import {
  type RoomDto,
  ROOMS_ERROR_EXAMPLES,
  ROOMS_EXAMPLE,
  RoomsDto,
} from './rooms.dto.js';

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
  @ApiOperation({
    summary:
      'Todas las habitaciones vendibles con su mantenimiento próximo, ordenadas por categoría y número, sin paginar y sin el estado de la habitación (FR-006).',
  })
  @ApiOkResponse({
    type: RoomsDto,
    description:
      'Las habitaciones vendibles. Sin habitaciones: `items: []` y `total: 0`.',
    example: ROOMS_EXAMPLE,
  })
  @ApiBadRequestResponse({
    type: ApiErrorBody,
    description:
      'Falló el inventario (`INVENTORY_UNAVAILABLE`) o hubo una excepción inesperada (`REQUEST_NOT_PROCESSED`).',
    examples: ROOMS_ERROR_EXAMPLES,
  })
  async list(): Promise<RoomsDto> {
    const items = (await this.rooms.execute()).map(toItem);
    return { items, total: items.length };
  }
}

/** Solo los campos de C1: si la habitación trajera otro dato, no sale (FR-006: sin estado de la habitación). */
function toItem(room: RoomWithMaintenance): RoomDto {
  return {
    id: room.id,
    roomNumber: room.roomNumber,
    categoryRoom: room.categoryRoom,
    maxCapacity: room.maxCapacity,
    maintenance: room.maintenance,
  };
}
