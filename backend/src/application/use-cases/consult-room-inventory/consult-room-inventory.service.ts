import { Inject, Injectable } from '@nestjs/common';
import { BusinessError } from '../../../domain/shared/business-error.js';
import {
  INVALID_CATEGORY,
  INVALID_ROOM_ID,
} from '../../../domain/shared/error-codes.js';
import type { Room } from '../../integration/room.js';
import {
  MODULE1_PORT,
  Module1RejectedError,
  Module1RoomNotFoundError,
  type Module1Port,
} from '../../ports/out/module1.port.js';
import { isValidCategoryRoom } from './category-room.validator.js';
import type { ConsultRoomInventory } from './ports/in/consult-room-inventory.port.js';
import { isValidRoomId } from './room-id.validator.js';

/**
 * Consulta el inventario del Módulo 1 (plan, D1 y D2): valida el `roomId` o la `categoryRoom` antes de
 * llamarlo y devuelve lo que responde sin modificar ningún dato. En `byRoomId`, un 404 o un 400 del
 * Módulo 1 es `INVALID_ROOM_ID`; en `byCategory`, un 400 es `INVALID_CATEGORY`.
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

  async byCategory(categoryRoom: string): Promise<Room[]> {
    if (!isValidCategoryRoom(categoryRoom)) {
      throw new BusinessError(INVALID_CATEGORY.code, INVALID_CATEGORY.message);
    }

    try {
      return await this.module1.listRoomsByCategory(categoryRoom);
    } catch (error) {
      if (error instanceof Module1RejectedError) {
        throw new BusinessError(
          INVALID_CATEGORY.code,
          INVALID_CATEGORY.message,
        );
      }
      throw error;
    }
  }
}
