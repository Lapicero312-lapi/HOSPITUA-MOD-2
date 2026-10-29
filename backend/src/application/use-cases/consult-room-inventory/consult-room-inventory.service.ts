import { Inject, Injectable, Logger } from '@nestjs/common';
import { BusinessError } from '../../../domain/shared/business-error.js';
import {
  INVALID_CATEGORY,
  INVALID_ROOM_ID,
  INVENTORY_UNAVAILABLE,
} from '../../../domain/shared/error-codes.js';
import type { Room } from '../../integration/room.js';
import {
  MODULE1_PORT,
  Module1RejectedError,
  Module1RoomNotFoundError,
  Module1UnavailableError,
  type Module1Port,
} from '../../ports/out/module1.port.js';
import { isValidCategoryRoom } from './category-room.validator.js';
import type { ConsultRoomInventory } from './ports/in/consult-room-inventory.port.js';
import { isValidRoomId } from './room-id.validator.js';

/**
 * Consulta el inventario del Módulo 1 (plan, D1, D2 y D3): valida el `roomId` o la `categoryRoom`, si los
 * recibe, antes de llamarlo y devuelve lo que responde sin modificar ningún dato. En `byRoomId`, un 404 o
 * un 400 del Módulo 1 es `INVALID_ROOM_ID`; en `byCategory`, un 400 es `INVALID_CATEGORY`. Si el Módulo 1
 * no responde, falla o responde algo mal formado (también un 404 en `byCategory`, y un 404 o un 400 en
 * `listAll`, que el contrato no prevé), es `INVENTORY_UNAVAILABLE`, con el detalle en el log: nunca se
 * asume ninguna habitación.
 */
@Injectable()
export class ConsultRoomInventoryService implements ConsultRoomInventory {
  private readonly logger = new Logger(ConsultRoomInventoryService.name);

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
      throw this.module1Failure(`de la habitación ${roomId}`, error);
    }
  }

  async byCategory(categoryRoom: string): Promise<Room[]> {
    if (!isValidCategoryRoom(categoryRoom)) {
      throw new BusinessError(INVALID_CATEGORY.code, INVALID_CATEGORY.message);
    }

    try {
      return await this.module1.listRoomsByCategory(categoryRoom);
    } catch (error) {
      const query = `de la categoría ${categoryRoom}`;
      if (error instanceof Module1RejectedError) {
        throw new BusinessError(
          INVALID_CATEGORY.code,
          INVALID_CATEGORY.message,
        );
      }
      if (error instanceof Module1RoomNotFoundError) {
        // Una categoría sin habitaciones devuelve una lista vacía (plan, A): el 404 está fuera del contrato.
        throw this.unavailable(
          query,
          'El Módulo 1 respondió 404, que el contrato no prevé en una lista.',
        );
      }
      throw this.module1Failure(query, error);
    }
  }

  async listAll(): Promise<Room[]> {
    try {
      return await this.module1.listRooms();
    } catch (error) {
      const query = 'de todas las habitaciones';
      if (
        error instanceof Module1RoomNotFoundError ||
        error instanceof Module1RejectedError
      ) {
        // A3 no tiene filtro (plan, A): el contrato no prevé ni un 404 ni un 400.
        const status = error instanceof Module1RoomNotFoundError ? 404 : 400;
        throw this.unavailable(
          query,
          `El Módulo 1 respondió ${status}, que el contrato no prevé en la consulta de todas las habitaciones.`,
        );
      }
      throw this.module1Failure(query, error);
    }
  }

  /**
   * Un Módulo 1 que no responde, falla o responde algo mal formado es `INVENTORY_UNAVAILABLE` (plan, D1 y
   * D2), con el detalle en el log: nunca se asume ninguna habitación. Un error inesperado sale tal cual.
   */
  private module1Failure(query: string, error: unknown): unknown {
    if (error instanceof Module1UnavailableError) {
      return this.unavailable(query, error.message);
    }
    return error;
  }

  /** Deja en el log por qué no se pudo consultar el inventario y devuelve `INVENTORY_UNAVAILABLE`. */
  private unavailable(query: string, detail: string): BusinessError {
    this.logger.warn(`Consulta del inventario ${query}: ${detail}`);
    return new BusinessError(
      INVENTORY_UNAVAILABLE.code,
      INVENTORY_UNAVAILABLE.message,
    );
  }
}
