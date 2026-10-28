import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { Room } from '../../../../../src/application/integration/room.js';
import {
  Module1RejectedError,
  Module1RoomNotFoundError,
  type Module1Port,
} from '../../../../../src/application/ports/out/module1.port.js';
import { ConsultRoomInventoryService } from '../../../../../src/application/use-cases/consult-room-inventory/consult-room-inventory.service.js';
import {
  INVALID_CATEGORY,
  INVALID_ROOM_ID,
} from '../../../../../src/domain/shared/error-codes.js';

/**
 * Datos de las pruebas del plan ("Pruebas por escenario", T005 y T006), que dice de dónde sale cada uno.
 * El `id` es un UUID cualquiera.
 */
const ROOM_201: Room = {
  id: randomUUID(),
  roomNumber: '201',
  categoryRoom: 'DOBLE',
  maxCapacity: 2,
};
const ROOM_202: Room = {
  id: randomUUID(),
  roomNumber: '202',
  categoryRoom: 'DOBLE',
  maxCapacity: 3,
};

/** Un Módulo 1 que responde `room` y registra cada consulta. */
function fakeModule1(room: Room) {
  const getRoom = vi.fn(() => Promise.resolve(room));
  return { getRoom, module1: { getRoom } as unknown as Module1Port };
}

/** Un Módulo 1 que responde `rooms` a la consulta por categoría y registra cada consulta. */
function fakeModule1List(rooms: Room[]) {
  const listRoomsByCategory = vi.fn(() => Promise.resolve(rooms));
  return {
    listRoomsByCategory,
    module1: { listRoomsByCategory } as unknown as Module1Port,
  };
}

/** Un Módulo 1 que falla con `error` en las dos consultas. */
function failingModule1(error: Error) {
  const fail = vi.fn(() => Promise.reject(error));
  return {
    module1: {
      getRoom: fail,
      listRoomsByCategory: fail,
    } as unknown as Module1Port,
  };
}

describe('ConsultRoomInventoryService.byRoomId', () => {
  it('devuelve la habitación tal como la manda el Módulo 1 y le pide ese roomId', async () => {
    const { getRoom, module1 } = fakeModule1(ROOM_201);

    expect(
      await new ConsultRoomInventoryService(module1).byRoomId(ROOM_201.id),
    ).toEqual(ROOM_201);
    expect(getRoom).toHaveBeenCalledWith(ROOM_201.id);
  });

  it.each([
    ['que es un número de habitación (201)', '201'],
    ['vacío', ''],
  ])(
    'un roomId %s es INVALID_ROOM_ID y no llama al Módulo 1',
    async (_, roomId) => {
      const { getRoom, module1 } = fakeModule1(ROOM_201);

      await expect(
        new ConsultRoomInventoryService(module1).byRoomId(roomId),
      ).rejects.toMatchObject({
        errorCode: INVALID_ROOM_ID.code,
        message: INVALID_ROOM_ID.message,
      });
      expect(getRoom).not.toHaveBeenCalled();
    },
  );

  it.each<[string, Error]>([
    ['un 404 (la habitación no existe)', new Module1RoomNotFoundError()],
    ['un 400 (rechaza el roomId)', new Module1RejectedError()],
  ])('%s del Módulo 1 es INVALID_ROOM_ID', async (_, error) => {
    const { module1 } = failingModule1(error);

    await expect(
      new ConsultRoomInventoryService(module1).byRoomId(ROOM_201.id),
    ).rejects.toMatchObject({
      errorCode: INVALID_ROOM_ID.code,
      message: INVALID_ROOM_ID.message,
    });
  });
});

describe('ConsultRoomInventoryService.byCategory', () => {
  it('devuelve todas las habitaciones de la categoría tal como las manda el Módulo 1 y le pide esa categoryRoom', async () => {
    const { listRoomsByCategory, module1 } = fakeModule1List([
      ROOM_201,
      ROOM_202,
    ]);

    expect(
      await new ConsultRoomInventoryService(module1).byCategory('DOBLE'),
    ).toEqual([ROOM_201, ROOM_202]);
    expect(listRoomsByCategory).toHaveBeenCalledWith('DOBLE');
  });

  it('una categoría sin habitaciones (SUITE_JUNIOR) devuelve una lista vacía, sin error', async () => {
    const { listRoomsByCategory, module1 } = fakeModule1List([]);

    expect(
      await new ConsultRoomInventoryService(module1).byCategory('SUITE_JUNIOR'),
    ).toEqual([]);
    expect(listRoomsByCategory).toHaveBeenCalledWith('SUITE_JUNIOR');
  });

  it.each([
    ['en minúsculas (doble)', 'doble'],
    ['vacía', ''],
  ])(
    'una categoryRoom %s es INVALID_CATEGORY y no llama al Módulo 1',
    async (_, categoryRoom) => {
      const { listRoomsByCategory, module1 } = fakeModule1List([
        ROOM_201,
        ROOM_202,
      ]);

      await expect(
        new ConsultRoomInventoryService(module1).byCategory(categoryRoom),
      ).rejects.toMatchObject({
        errorCode: INVALID_CATEGORY.code,
        message: INVALID_CATEGORY.message,
      });
      expect(listRoomsByCategory).not.toHaveBeenCalled();
    },
  );

  it('un 400 del Módulo 1 (rechaza la categoryRoom) es INVALID_CATEGORY', async () => {
    const { module1 } = failingModule1(new Module1RejectedError());

    await expect(
      new ConsultRoomInventoryService(module1).byCategory('DOBLE'),
    ).rejects.toMatchObject({
      errorCode: INVALID_CATEGORY.code,
      message: INVALID_CATEGORY.message,
    });
  });
});
