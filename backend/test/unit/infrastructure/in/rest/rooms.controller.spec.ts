import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type {
  ListRoomsWithMaintenance,
  RoomWithMaintenance,
} from '../../../../../src/application/use-cases/consult-room-inventory/ports/in/list-rooms-with-maintenance.port.js';
import { RoomsController } from '../../../../../src/infrastructure/in/rest/rooms.controller.js';

/** El ejemplo de C1 del plan: la 201 con un mantenimiento y la 202 sin mantenimientos. Los `id` son UUID cualesquiera. */
const ROOM_201: RoomWithMaintenance = {
  id: randomUUID(),
  roomNumber: '201',
  categoryRoom: 'DOBLE',
  maxCapacity: 2,
  maintenance: {
    status: 'SCHEDULED',
    maintenanceStart: '2026-10-20',
    maintenanceEnd: '2026-10-22',
  },
};
const ROOM_202: RoomWithMaintenance = {
  id: randomUUID(),
  roomNumber: '202',
  categoryRoom: 'DOBLE',
  maxCapacity: 3,
  maintenance: { status: 'NONE', maintenanceStart: null, maintenanceEnd: null },
};

/** El controlador con un servicio que responde `rooms`. */
function controllerAnswering(rooms: RoomWithMaintenance[]) {
  const execute = vi.fn(() => Promise.resolve(rooms));
  return {
    execute,
    controller: new RoomsController({
      execute,
    } as unknown as ListRoomsWithMaintenance),
  };
}

describe('RoomsController.list (C1)', () => {
  it('responde las habitaciones en el orden del servicio, con el total', async () => {
    const { execute, controller } = controllerAnswering([ROOM_201, ROOM_202]);

    expect(await controller.list()).toEqual({
      items: [ROOM_201, ROOM_202],
      total: 2,
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('solo lleva los campos de C1: un estado de la habitación no sale (FR-006)', async () => {
    // El estado `Occupied` es el del ejemplo de los datos de las pruebas del adaptador (T008).
    const withStatus = {
      ...ROOM_201,
      status: 'Occupied',
      maintenance: { ...ROOM_201.maintenance, status: 'SCHEDULED' as const },
    };
    const { controller } = controllerAnswering([withStatus]);

    const response = await controller.list();

    expect(response.items[0]).toStrictEqual(ROOM_201);
  });

  it('sin habitaciones responde items vacío y total 0', async () => {
    const { controller } = controllerAnswering([]);

    expect(await controller.list()).toEqual({ items: [], total: 0 });
  });
});
