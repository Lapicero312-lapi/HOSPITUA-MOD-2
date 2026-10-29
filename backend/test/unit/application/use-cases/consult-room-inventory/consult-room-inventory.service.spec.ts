import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Room } from '../../../../../src/application/integration/room.js';
import {
  Module1RejectedError,
  Module1RoomNotFoundError,
  Module1UnavailableError,
  type Module1Port,
} from '../../../../../src/application/ports/out/module1.port.js';
import { ConsultRoomInventoryService } from '../../../../../src/application/use-cases/consult-room-inventory/consult-room-inventory.service.js';
import {
  INVALID_CATEGORY,
  INVALID_ROOM_ID,
  INVENTORY_UNAVAILABLE,
} from '../../../../../src/domain/shared/error-codes.js';

/**
 * Datos de las pruebas del plan ("Pruebas por escenario", T005, T006, T007 y T010), que dice de dónde sale
 * cada uno. El `id` es un UUID cualquiera.
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

/** Los motivos que da el adaptador cuando el Módulo 1 no está disponible. */
const UNAVAILABLE_DETAILS = [
  'tiempo de espera agotado',
  'sin respuesta (ECONNREFUSED)',
  'respondió 503',
  'la respuesta no es JSON',
  'respuesta distinta del contrato',
];

afterEach(() => {
  vi.restoreAllMocks();
});

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

/**
 * Un Módulo 1 que responde `rooms` a la consulta de todas las habitaciones y registra cada consulta, también
 * las que se hicieran por categoría.
 */
function fakeModule1All(rooms: Room[]) {
  const listRooms = vi.fn(() => Promise.resolve(rooms));
  const listRoomsByCategory = vi.fn(() => Promise.resolve(rooms));
  return {
    listRooms,
    listRoomsByCategory,
    module1: { listRooms, listRoomsByCategory } as unknown as Module1Port,
  };
}

/** Un Módulo 1 que falla con `error` en todas las consultas. */
function failingModule1(error: Error) {
  const fail = vi.fn(() => Promise.reject(error));
  return {
    module1: {
      getRoom: fail,
      listRoomsByCategory: fail,
      listRooms: fail,
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

  it.each(UNAVAILABLE_DETAILS)(
    'el Módulo 1 no disponible (%s) es INVENTORY_UNAVAILABLE y deja el detalle en el log',
    async (detail) => {
      const warn = vi
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      const { module1 } = failingModule1(new Module1UnavailableError(detail));

      await expect(
        new ConsultRoomInventoryService(module1).byRoomId(ROOM_201.id),
      ).rejects.toMatchObject({
        errorCode: INVENTORY_UNAVAILABLE.code,
        message: INVENTORY_UNAVAILABLE.message,
      });
      expect(warn).toHaveBeenCalledWith(
        `Consulta del inventario de la habitación ${ROOM_201.id}: El Módulo 1 no está disponible: ${detail}.`,
      );
    },
  );

  it('un error inesperado sale sin convertir', async () => {
    const unexpected = new Error('falla inesperada');
    const { module1 } = failingModule1(unexpected);

    await expect(
      new ConsultRoomInventoryService(module1).byRoomId(ROOM_201.id),
    ).rejects.toBe(unexpected);
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

  it('un 404 del Módulo 1, que el contrato no prevé en una lista, es INVENTORY_UNAVAILABLE y deja el detalle en el log', async () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const { module1 } = failingModule1(new Module1RoomNotFoundError());

    await expect(
      new ConsultRoomInventoryService(module1).byCategory('DOBLE'),
    ).rejects.toMatchObject({
      errorCode: INVENTORY_UNAVAILABLE.code,
      message: INVENTORY_UNAVAILABLE.message,
    });
    expect(warn).toHaveBeenCalledWith(
      'Consulta del inventario de la categoría DOBLE: El Módulo 1 respondió 404, que el contrato no prevé en una lista.',
    );
  });

  it.each(UNAVAILABLE_DETAILS)(
    'el Módulo 1 no disponible (%s) es INVENTORY_UNAVAILABLE y deja el detalle en el log',
    async (detail) => {
      const warn = vi
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      const { module1 } = failingModule1(new Module1UnavailableError(detail));

      await expect(
        new ConsultRoomInventoryService(module1).byCategory('DOBLE'),
      ).rejects.toMatchObject({
        errorCode: INVENTORY_UNAVAILABLE.code,
        message: INVENTORY_UNAVAILABLE.message,
      });
      expect(warn).toHaveBeenCalledWith(
        `Consulta del inventario de la categoría DOBLE: El Módulo 1 no está disponible: ${detail}.`,
      );
    },
  );

  it('un error inesperado sale sin convertir', async () => {
    const unexpected = new Error('falla inesperada');
    const { module1 } = failingModule1(unexpected);

    await expect(
      new ConsultRoomInventoryService(module1).byCategory('DOBLE'),
    ).rejects.toBe(unexpected);
  });
});

describe('ConsultRoomInventoryService.listAll', () => {
  it('devuelve todas las habitaciones tal como las manda el Módulo 1, con una sola consulta y sin consultar por categoría', async () => {
    const { listRooms, listRoomsByCategory, module1 } = fakeModule1All([
      ROOM_201,
      ROOM_202,
    ]);

    expect(await new ConsultRoomInventoryService(module1).listAll()).toEqual([
      ROOM_201,
      ROOM_202,
    ]);
    expect(listRooms).toHaveBeenCalledTimes(1);
    expect(listRooms).toHaveBeenCalledWith();
    expect(listRoomsByCategory).not.toHaveBeenCalled();
  });

  it('sin habitaciones devuelve una lista vacía, sin error', async () => {
    const { module1 } = fakeModule1All([]);

    expect(await new ConsultRoomInventoryService(module1).listAll()).toEqual(
      [],
    );
  });

  it.each(UNAVAILABLE_DETAILS)(
    'el Módulo 1 no disponible (%s) es INVENTORY_UNAVAILABLE y deja el detalle en el log',
    async (detail) => {
      const warn = vi
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      const { module1 } = failingModule1(new Module1UnavailableError(detail));

      await expect(
        new ConsultRoomInventoryService(module1).listAll(),
      ).rejects.toMatchObject({
        errorCode: INVENTORY_UNAVAILABLE.code,
        message: INVENTORY_UNAVAILABLE.message,
      });
      expect(warn).toHaveBeenCalledWith(
        `Consulta del inventario de todas las habitaciones: El Módulo 1 no está disponible: ${detail}.`,
      );
    },
  );

  it.each<[number, Error]>([
    [404, new Module1RoomNotFoundError()],
    [400, new Module1RejectedError()],
  ])(
    'un %i del Módulo 1, que el contrato no prevé en esta consulta, es INVENTORY_UNAVAILABLE y deja el detalle en el log',
    async (status, error) => {
      const warn = vi
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      const { module1 } = failingModule1(error);

      await expect(
        new ConsultRoomInventoryService(module1).listAll(),
      ).rejects.toMatchObject({
        errorCode: INVENTORY_UNAVAILABLE.code,
        message: INVENTORY_UNAVAILABLE.message,
      });
      expect(warn).toHaveBeenCalledWith(
        `Consulta del inventario de todas las habitaciones: El Módulo 1 respondió ${status}, que el contrato no prevé en la consulta de todas las habitaciones.`,
      );
    },
  );

  it('un error inesperado sale sin convertir', async () => {
    const unexpected = new Error('falla inesperada');
    const { module1 } = failingModule1(unexpected);

    await expect(
      new ConsultRoomInventoryService(module1).listAll(),
    ).rejects.toBe(unexpected);
  });
});
