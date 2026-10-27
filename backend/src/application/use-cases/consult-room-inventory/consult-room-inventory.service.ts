import { Inject, Injectable } from '@nestjs/common';
import { BusinessError } from '../../../domain/shared/business-error.js';
import { INVALID_ROOM_ID } from '../../../domain/shared/error-codes.js';
import type { Room } from '../../integration/room.js';
import {
  MODULE1_PORT,
  Module1RejectedError,
  Module1RoomNotFoundError,
  type Module1Port,
} from '../../ports/out/module1.port.js';
import type { ConsultRoomInventory } from './ports/in/consult-room-inventory.port.js';
import { isValidRoomId } from './room-id.validator.js';

/**
 * Consulta el inventario del Módulo 1 (plan, D1): valida el `roomId` antes de llamarlo y devuelve la
 * habitación sin modificar ningún dato. Un 404 o un 400 del Módulo 1 es `INVALID_ROOM_ID`.
 */
@Injectable()
export class ConsultRoomInventoryService implements ConsultRoomInventory {
  constructor(
    @Inject(MODULE1_PORT)
    private readonly module1: Module1Port,
  ) {}

  async byRoomId(roomId: string): Promise<Room> {
    if (!isValidRoomId(roomId)) {
      throw new BusinessError(INVALID_ROOM_ID.code, INVALID_ROOM_ID.message);
    }

    try {
      return await this.module1.getRoom(roomId);
    } catch (error) {
      if (
        error instanceof Module1RoomNotFoundError ||
        error instanceof Module1RejectedError
      ) {
        throw new BusinessError(INVALID_ROOM_ID.code, INVALID_ROOM_ID.message);
      }
      throw error;
    }
  }
}
