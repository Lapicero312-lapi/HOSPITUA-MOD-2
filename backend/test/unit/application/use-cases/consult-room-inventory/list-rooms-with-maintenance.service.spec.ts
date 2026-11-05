import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MaintenanceConflict } from '../../../../../src/application/integration/maintenance-calendar.js';
import type { Room } from '../../../../../src/application/integration/room.js';
import type { Clock } from '../../../../../src/application/ports/out/clock.js';
import type { ConsultMaintenanceCalendar } from '../../../../../src/application/use-cases/consult-maintenance-calendar/ports/in/consult-maintenance-calendar.port.js';
import { ListRoomsWithMaintenanceService } from '../../../../../src/application/use-cases/consult-room-inventory/list-rooms-with-maintenance.service.js';
import type { ConsultRoomInventory } from '../../../../../src/application/use-cases/consult-room-inventory/ports/in/consult-room-inventory.port.js';
import { BusinessError } from '../../../../../src/domain/shared/business-error.js';
import {
  INVALID_ROOM_ID,
  INVENTORY_UNAVAILABLE,
  MAINTENANCE_CHECK_UNAVAILABLE,
} from '../../../../../src/domain/shared/error-codes.js';

/**
 * Datos de las pruebas del plan ("Pruebas por escenario", T011), que dice de dónde sale cada uno: el
 * ejemplo de C1, con el reloj simulado en el 2026-10-11. Los `id` son UUID cualesquiera.
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
const TODAY = '2026-10-11';
/** La salida de la ventana: hoy más 30 días, así que cubre los siguientes 30 días contando hoy. */
const WINDOW_END = '2026-11-10';
/** El mantenimiento más cercano de la 201 en la ventana. */
const NEXT_201: MaintenanceConflict = {
  maintenanceStart: '2026-10-20',
  maintenanceEnd: '2026-10-22',
  overlapStart: '2026-10-20',
  overlapEnd: '2026-10-22',
};

afterEach(() => {
  vi.restoreAllMocks();
});

/** Un inventario que responde `rooms`, o que falla con `error`. */
function fakeInventory(rooms: Room[] | Error) {
  const listAll = vi.fn(() =>
    rooms instanceof Error ? Promise.reject(rooms) : Promise.resolve(rooms),
  );
  return { listAll, inventory: { listAll } as unknown as ConsultRoomInventory };
}

/**
 * Un calendario que responde a cada habitación lo que diga `answers` (su mantenimiento próximo, `null` o
 * un error) y registra cada consulta.
 */
function fakeCalendar(
  answers: Map<string, MaintenanceConflict | null | Error>,
) {
  const nextMaintenance = vi.fn((roomId: string) => {
    const answer = answers.get(roomId) ?? null;
    return answer instanceof Error
      ? Promise.reject(answer)
      : Promise.resolve(answer);
  });
  return {
    nextMaintenance,
    calendar: { nextMaintenance } as unknown as ConsultMaintenanceCalendar,
  };
}

/** Un reloj simulado en el día `today`. */
function fakeClock(today: string): Clock {
  return { today: () => today, now: () => new Date(`${today}T12:00:00Z`) };
}

describe('ListRoomsWithMaintenanceService.execute', () => {
  it('pide el mantenimiento próximo de cada habitación en los siguientes 30 días contando hoy', async () => {
    const { inventory } = fakeInventory([ROOM_201, ROOM_202]);
    const { nextMaintenance, calendar } = fakeCalendar(new Map());

    await new ListRoomsWithMaintenanceService(
      inventory,
      calendar,
      fakeClock(TODAY),
      5,
    ).execute();

    expect(nextMaintenance).toHaveBeenCalledTimes(2);
    expect(nextMaintenance).toHaveBeenCalledWith(
      ROOM_201.id,
      TODAY,
      WINDOW_END,
    );
    expect(nextMaintenance).toHaveBeenCalledWith(
      ROOM_202.id,
      TODAY,
      WINDOW_END,
    );
  });

  it('la 201 con un mantenimiento sale SCHEDULED con sus fechas y la 202 sin mantenimientos sale NONE', async () => {
    const { inventory } = fakeInventory([ROOM_201, ROOM_202]);
    const { calendar } = fakeCalendar(new Map([[ROOM_201.id, NEXT_201]]));

    expect(
      await new ListRoomsWithMaintenanceService(
        inventory,
        calendar,
        fakeClock(TODAY),
        5,
      ).execute(),
    ).toEqual([
      {
        ...ROOM_201,
        maintenance: {
          status: 'SCHEDULED',
          maintenanceStart: '2026-10-20',
          maintenanceEnd: '2026-10-22',
        },
      },
      {
        ...ROOM_202,
        maintenance: {
          status: 'NONE',
          maintenanceStart: null,
          maintenanceEnd: null,
        },
      },
    ]);
  });

  it('un mantenimiento que ya empezó sale SCHEDULED con sus fechas completas, no con las del cruce', async () => {
    const { inventory } = fakeInventory([ROOM_201]);
    const { calendar } = fakeCalendar(
      new Map([
        [
          ROOM_201.id,
          {
            maintenanceStart: '2026-10-10',
            maintenanceEnd: '2026-10-12',
            overlapStart: '2026-10-11',
            overlapEnd: '2026-10-12',
          },
        ],
      ]),
    );

    expect(
      await new ListRoomsWithMaintenanceService(
        inventory,
        calendar,
        fakeClock(TODAY),
        5,
      ).execute(),
    ).toEqual([
      {
        ...ROOM_201,
        maintenance: {
          status: 'SCHEDULED',
          maintenanceStart: '2026-10-10',
          maintenanceEnd: '2026-10-12',
        },
      },
    ]);
  });

  it.each<[string, Error, string]>([
    [
      'no disponible',
      new BusinessError(
        MAINTENANCE_CHECK_UNAVAILABLE.code,
        MAINTENANCE_CHECK_UNAVAILABLE.message,
      ),
      MAINTENANCE_CHECK_UNAVAILABLE.code,
    ],
    [
      'INVALID_ROOM_ID',
      new BusinessError(INVALID_ROOM_ID.code, INVALID_ROOM_ID.message),
      INVALID_ROOM_ID.code,
    ],
    ['un error inesperado', new Error('falla inesperada'), 'Error'],
  ])(
    'si falla el calendario de una habitación (%s), esa sale UNAVAILABLE, las demás siguen y queda en el log',
    async (_, error, reason) => {
      const warn = vi
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      const { inventory } = fakeInventory([ROOM_201, ROOM_202]);
      const { calendar } = fakeCalendar(new Map([[ROOM_201.id, error]]));

      expect(
        await new ListRoomsWithMaintenanceService(
          inventory,
          calendar,
          fakeClock(TODAY),
          5,
        ).execute(),
      ).toEqual([
        {
          ...ROOM_201,
          maintenance: {
            status: 'UNAVAILABLE',
            maintenanceStart: null,
            maintenanceEnd: null,
          },
        },
        {
          ...ROOM_202,
          maintenance: {
            status: 'NONE',
            maintenanceStart: null,
            maintenanceEnd: null,
          },
        },
      ]);
      expect(warn).toHaveBeenCalledWith(
        `Mantenimiento próximo de la habitación ${ROOM_201.id} no disponible: ${reason}`,
      );
    },
  );

  it('si falla el inventario, sale INVENTORY_UNAVAILABLE sin consultar ningún calendario', async () => {
    const failure = new BusinessError(
      INVENTORY_UNAVAILABLE.code,
      INVENTORY_UNAVAILABLE.message,
    );
    const { inventory } = fakeInventory(failure);
    const { nextMaintenance, calendar } = fakeCalendar(new Map());

    await expect(
      new ListRoomsWithMaintenanceService(
        inventory,
        calendar,
        fakeClock(TODAY),
        5,
      ).execute(),
    ).rejects.toBe(failure);
    expect(nextMaintenance).not.toHaveBeenCalled();
  });

  it('sin habitaciones devuelve una lista vacía, sin consultar ningún calendario', async () => {
    const { inventory } = fakeInventory([]);
    const { nextMaintenance, calendar } = fakeCalendar(new Map());

    expect(
      await new ListRoomsWithMaintenanceService(
        inventory,
        calendar,
        fakeClock(TODAY),
        5,
      ).execute(),
    ).toEqual([]);
    expect(nextMaintenance).not.toHaveBeenCalled();
  });

  it.each([
    [1, 'de a una'],
    [2, 'a la vez'],
  ])(
    'con el tope en %i, la 201 y la 202 se consultan %s',
    async (concurrency) => {
      const { inventory } = fakeInventory([ROOM_201, ROOM_202]);
      let inFlight = 0;
      let maxInFlight = 0;
      const nextMaintenance = vi.fn(async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 10));
        inFlight -= 1;
        return null;
      });

      await new ListRoomsWithMaintenanceService(
        inventory,
        { nextMaintenance } as unknown as ConsultMaintenanceCalendar,
        fakeClock(TODAY),
        concurrency,
      ).execute();

      expect(nextMaintenance).toHaveBeenCalledTimes(2);
      expect(maxInFlight).toBe(concurrency);
    },
  );

  it('devuelve las habitaciones ordenadas por categoría y luego por número, con los dígitos como número (plan, C1)', async () => {
    // Datos de las pruebas del plan (T012): la 1001 y la 101 de `SUITE_JUNIOR` muestran el orden por número y por categoría.
    const room1001: Room = {
      id: randomUUID(),
      roomNumber: '1001',
      categoryRoom: 'DOBLE',
      maxCapacity: 2,
    };
    const suite101: Room = {
      id: randomUUID(),
      roomNumber: '101',
      categoryRoom: 'SUITE_JUNIOR',
      maxCapacity: 2,
    };
    const { inventory } = fakeInventory([
      suite101,
      room1001,
      ROOM_202,
      ROOM_201,
    ]);
    const { calendar } = fakeCalendar(new Map());

    const rooms = await new ListRoomsWithMaintenanceService(
      inventory,
      calendar,
      fakeClock(TODAY),
      5,
    ).execute();

    expect(rooms.map((room) => [room.categoryRoom, room.roomNumber])).toEqual([
      ['DOBLE', '201'],
      ['DOBLE', '202'],
      ['DOBLE', '1001'],
      ['SUITE_JUNIOR', '101'],
    ]);
  });

  it('la ventana pasa bien de un año al otro: con el reloj en el 2026-12-15 se pide hasta el 2027-01-14', async () => {
    const { inventory } = fakeInventory([ROOM_201]);
    const { nextMaintenance, calendar } = fakeCalendar(new Map());

    await new ListRoomsWithMaintenanceService(
      inventory,
      calendar,
      fakeClock('2026-12-15'),
      5,
    ).execute();

    expect(nextMaintenance).toHaveBeenCalledWith(
      ROOM_201.id,
      '2026-12-15',
      '2027-01-14',
    );
  });
});
