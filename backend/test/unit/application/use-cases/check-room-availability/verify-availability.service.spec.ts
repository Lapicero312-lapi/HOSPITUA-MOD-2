import { describe, expect, it, vi } from 'vitest';
import type { MaintenanceCheck } from '../../../../../src/application/integration/maintenance-calendar.js';
import type { Room } from '../../../../../src/application/integration/room.js';
import type { ReservationLookup } from '../../../../../src/application/use-cases/check-view-reservation/ports/in/reservation-lookup.port.js';
import type { AvailabilityQuery } from '../../../../../src/application/use-cases/check-room-availability/ports/in/verify-availability.port.js';
import { VerifyAvailabilityService } from '../../../../../src/application/use-cases/check-room-availability/verify-availability.service.js';
import type { ConsultMaintenanceCalendar } from '../../../../../src/application/use-cases/consult-maintenance-calendar/ports/in/consult-maintenance-calendar.port.js';
import type { ConsultRoomInventory } from '../../../../../src/application/use-cases/consult-room-inventory/ports/in/consult-room-inventory.port.js';
import { BusinessError } from '../../../../../src/domain/shared/business-error.js';

/** Las habitaciones y las fechas del ejemplo del DTO del plan (B). */
const START = '2026-10-10';
const END = '2026-10-12';
const room = (roomNumber: string, id: string): Room => ({
  id,
  roomNumber,
  categoryRoom: 'DOBLE',
  maxCapacity: 2,
});
const ROOM_201 = room('201', '3f6c1e2a-8b4d-4c7e-9a1f-2b3c4d5e6f70');
const ROOM_202 = room('202', '7a2d9c4e-1f3b-4e8a-b6c5-0d9e8f7a6b51');
const ROOM_203 = room('203', 'c8e4b2a6-5d7f-4a1c-8e3b-9f0a1b2c3d42');
const OWN_RESERVATION = 'RSV-0A1B2C3D';

/** El mantenimiento de la 203 en el ejemplo del DTO: se cruza el 11 (la noche del 11 al 12). */
const MAINTENANCE_203: MaintenanceCheck = {
  roomId: ROOM_203.id,
  available: false,
  conflicts: [
    {
      maintenanceStart: '2026-10-11',
      maintenanceEnd: '2026-10-14',
      overlapStart: '2026-10-11',
      overlapEnd: '2026-10-12',
    },
  ],
};

const free = (roomId: string): MaintenanceCheck => ({
  roomId,
  available: true,
  conflicts: [],
});

/**
 * El servicio con el inventario, las reservas y el calendario simulados. Por defecto: la categoría
 * `DOBLE` tiene la 201, la 202 y la 203; la 202 ya está reservada y la 203 tiene un mantenimiento.
 */
function serviceWith({
  rooms = [ROOM_201, ROOM_202, ROOM_203],
  blocked = [ROOM_202.id],
  maintenance = (roomId: string) =>
    Promise.resolve(roomId === ROOM_203.id ? MAINTENANCE_203 : free(roomId)),
  concurrency = 5,
}: {
  rooms?: Room[];
  blocked?: string[];
  maintenance?: (roomId: string) => Promise<MaintenanceCheck>;
  concurrency?: number;
} = {}) {
  const calls: string[] = [];
  const byCategory = vi.fn((categoryRoom: string) => {
    calls.push(`byCategory ${categoryRoom}`);
    return Promise.resolve(rooms);
  });
  const byRoomId = vi.fn((roomId: string) => {
    calls.push(`byRoomId ${roomId}`);
    const found = rooms.find((candidate) => candidate.id === roomId);
    return found
      ? Promise.resolve(found)
      : Promise.reject(
          new BusinessError(
            'INVALID_ROOM_ID',
            'El identificador de la habitación es inválido.',
          ),
        );
  });
  const findBlockingRooms = vi.fn((roomIds: string[]) => {
    calls.push('findBlockingRooms');
    return Promise.resolve(
      blocked
        .filter((roomId) => roomIds.includes(roomId))
        .map((roomId) => ({ roomId, reservationRef: 'RSV-9F8E7D6C' })),
    );
  });
  const check = vi.fn((roomId: string) => {
    calls.push(`maintenance ${roomId}`);
    return maintenance(roomId);
  });
  const service = new VerifyAvailabilityService(
    { byCategory, byRoomId } as unknown as ConsultRoomInventory,
    { findBlockingRooms } as ReservationLookup,
    { check } as unknown as ConsultMaintenanceCalendar,
    concurrency,
  );
  return { service, calls, byCategory, byRoomId, findBlockingRooms, check };
}

const byCategory = (changes: Partial<AvailabilityQuery> = {}) => ({
  startDate: START,
  endDate: END,
  categoryRoom: 'DOBLE',
  ...changes,
});

describe('VerifyAvailability.check por categoría (T006)', () => {
  it('devuelve cada habitación con su motivo: disponible, reservada o en mantenimiento (FR-002a)', async () => {
    const { service } = serviceWith();

    await expect(service.check(byCategory())).resolves.toEqual({
      startDate: START,
      endDate: END,
      rooms: [
        { room: ROOM_201, available: true, reason: null, maintenance: [] },
        {
          room: ROOM_202,
          available: false,
          reason: 'RESERVED',
          maintenance: [],
        },
        {
          room: ROOM_203,
          available: false,
          reason: 'MAINTENANCE',
          maintenance: [
            { overlapStart: '2026-10-11', overlapEnd: '2026-10-12' },
          ],
        },
      ],
    });
  });

  it('va en el orden del plan: inventario, cruce con las reservas y después los mantenimientos', async () => {
    const { service, calls } = serviceWith();

    await service.check(byCategory());

    expect(calls).toEqual([
      'byCategory DOBLE',
      'findBlockingRooms',
      `maintenance ${ROOM_201.id}`,
      `maintenance ${ROOM_203.id}`,
    ]);
  });

  it('cruza con las reservas todas las habitaciones de la categoría, en las fechas pedidas', async () => {
    const { service, findBlockingRooms } = serviceWith();

    await service.check(byCategory());

    expect(findBlockingRooms).toHaveBeenCalledWith(
      [ROOM_201.id, ROOM_202.id, ROOM_203.id],
      START,
      END,
      undefined,
    );
  });

  it('una habitación reservada no se consulta en el calendario: sale RESERVED aunque tenga mantenimiento', async () => {
    const { service, check } = serviceWith({ blocked: [ROOM_203.id] });

    const result = await service.check(byCategory());

    expect(check).not.toHaveBeenCalledWith(ROOM_203.id, START, END);
    expect(result.rooms[2]).toMatchObject({
      room: ROOM_203,
      reason: 'RESERVED',
      maintenance: [],
    });
  });

  it('consulta el calendario de cada candidata con las fechas pedidas', async () => {
    const { service, check } = serviceWith({ blocked: [] });

    await service.check(byCategory());

    expect(check.mock.calls).toEqual([
      [ROOM_201.id, START, END],
      [ROOM_202.id, START, END],
      [ROOM_203.id, START, END],
    ]);
  });

  it('pasa la reserva que se modifica al cruce con las reservas', async () => {
    const { service, findBlockingRooms } = serviceWith();

    await service.check(byCategory({ excludeReservationRef: OWN_RESERVATION }));

    expect(findBlockingRooms).toHaveBeenCalledWith(
      expect.any(Array),
      START,
      END,
      OWN_RESERVATION,
    );
  });

  it('ordena las habitaciones por roomNumber en orden numérico: la 201 antes que la 1001', async () => {
    const room1001 = room('1001', '5b9f3d7c-2e4a-4b6d-a8c1-7e6f5d4c3b23');
    const { service } = serviceWith({
      rooms: [room1001, ROOM_202, ROOM_201],
      blocked: [],
    });

    const { rooms } = await service.check(byCategory());

    expect(rooms.map(({ room }) => room.roomNumber)).toEqual([
      '201',
      '202',
      '1001',
    ]);
  });

  it('una categoría sin habitaciones devuelve una lista vacía, sin consultar el calendario', async () => {
    const { service, check } = serviceWith({ rooms: [] });

    await expect(service.check(byCategory())).resolves.toEqual({
      startDate: START,
      endDate: END,
      rooms: [],
    });
    expect(check).not.toHaveBeenCalled();
  });

  it('si el inventario falla, sale su error sin cruzar con las reservas', async () => {
    const { service, byCategory: inventory, findBlockingRooms } = serviceWith();
    inventory.mockRejectedValueOnce(
      new BusinessError('INVENTORY_UNAVAILABLE', 'sin inventario'),
    );

    await expect(service.check(byCategory())).rejects.toMatchObject({
      errorCode: 'INVENTORY_UNAVAILABLE',
    });
    expect(findBlockingRooms).not.toHaveBeenCalled();
  });
});

describe('VerifyAvailability.check por roomId (T007)', () => {
  it('pide esa habitación al inventario y la verifica sola', async () => {
    const {
      service,
      byCategory: inventory,
      byRoomId,
      findBlockingRooms,
    } = serviceWith({ blocked: [] });

    await expect(
      service.check({ startDate: START, endDate: END, roomId: ROOM_201.id }),
    ).resolves.toEqual({
      startDate: START,
      endDate: END,
      rooms: [
        { room: ROOM_201, available: true, reason: null, maintenance: [] },
      ],
    });
    expect(byRoomId).toHaveBeenCalledWith(ROOM_201.id);
    expect(inventory).not.toHaveBeenCalled();
    expect(findBlockingRooms).toHaveBeenCalledWith(
      [ROOM_201.id],
      START,
      END,
      undefined,
    );
  });

  it('una habitación que el inventario no conoce da INVALID_ROOM_ID, sin cruzar con las reservas', async () => {
    const { service, findBlockingRooms } = serviceWith();

    await expect(
      service.check({
        startDate: START,
        endDate: END,
        roomId: '9f1c2b3a-4d5e-4f60-8a7b-1c2d3e4f5a6b',
      }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_ROOM_ID' });
    expect(findBlockingRooms).not.toHaveBeenCalled();
  });

  it('una habitación reservada sale RESERVED', async () => {
    const { service } = serviceWith();

    const { rooms } = await service.check({
      startDate: START,
      endDate: END,
      roomId: ROOM_202.id,
    });

    expect(rooms).toEqual([
      { room: ROOM_202, available: false, reason: 'RESERVED', maintenance: [] },
    ]);
  });
});

describe('VerifyAvailability.check: validación antes de consultar a nadie', () => {
  it.each<[string, AvailabilityQuery, string]>([
    [
      'la salida antes de la llegada',
      byCategory({ startDate: END, endDate: START }),
      'INVALID_STAY_DATES',
    ],
    [
      'la salida el mismo día de la llegada',
      byCategory({ endDate: START }),
      'INVALID_STAY_DATES',
    ],
    [
      'una fecha que no existe',
      byCategory({ startDate: '2026-02-30', endDate: '2026-03-02' }),
      'INVALID_STAY_DATES',
    ],
    [
      'ni categoría ni roomId',
      { startDate: START, endDate: END },
      'INVALID_AVAILABILITY_QUERY',
    ],
    [
      'categoría y roomId a la vez',
      byCategory({ roomId: ROOM_201.id }),
      'INVALID_AVAILABILITY_QUERY',
    ],
    [
      'la reserva que se modifica con otro formato',
      byCategory({ excludeReservationRef: 'rsv-0a1b2c3d' }),
      'RESERVATION_NOT_FOUND',
    ],
  ])('con %s da %s', async (_caso, query, errorCode) => {
    const { service, calls } = serviceWith();

    await expect(service.check(query)).rejects.toMatchObject({ errorCode });
    expect(calls).toEqual([]);
  });

  it('los mensajes son los literales del plan', async () => {
    const { service } = serviceWith();

    await expect(
      service.check(byCategory({ endDate: START })),
    ).rejects.toMatchObject({
      message: 'Rango de fechas inválido. Verifique las fechas seleccionadas.',
    });
    await expect(
      service.check({ startDate: START, endDate: END }),
    ).rejects.toMatchObject({
      message: 'Debe indicar una categoría o una habitación.',
    });
    await expect(
      service.check(byCategory({ excludeReservationRef: 'RSV-1' })),
    ).rejects.toMatchObject({ message: 'La reserva no existe.' });
  });
});

describe('VerifyAvailability.check: mantenimientos en paralelo y todo o nada (T009)', () => {
  /** Un calendario que tarda y cuenta cuántas consultas hay en curso a la vez. */
  function slowCalendar() {
    const state = { running: 0, maxRunning: 0 };
    const maintenance = async (roomId: string) => {
      state.running++;
      state.maxRunning = Math.max(state.maxRunning, state.running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      state.running--;
      return free(roomId);
    };
    return { maintenance, state };
  }
  const fiveRooms = ['301', '302', '303', '304', '305'].map((number, index) =>
    room(number, `0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4${index}`),
  );

  it.each([1, 2, 5])(
    'con MAINTENANCE_CONCURRENCY en %i, nunca hay más consultas a la vez',
    async (concurrency) => {
      const { maintenance, state } = slowCalendar();
      const { service, check } = serviceWith({
        rooms: fiveRooms,
        blocked: [],
        maintenance,
        concurrency,
      });

      await service.check(byCategory());

      expect(state.maxRunning).toBe(concurrency);
      expect(check).toHaveBeenCalledTimes(5);
    },
  );

  it('si falla el calendario de una sola habitación, falla toda la verificación: no se asume disponibilidad', async () => {
    const { service } = serviceWith({
      blocked: [],
      maintenance: (roomId) =>
        roomId === ROOM_202.id
          ? Promise.reject(
              new BusinessError(
                'MAINTENANCE_CHECK_UNAVAILABLE',
                'No es posible validar mantenimientos en este momento. Intente de nuevo.',
              ),
            )
          : Promise.resolve(free(roomId)),
    });

    await expect(service.check(byCategory())).rejects.toMatchObject({
      errorCode: 'MAINTENANCE_CHECK_UNAVAILABLE',
    });
  });

  it('después del primer fallo no consulta más habitaciones, aunque otra siga en curso', async () => {
    // Dos a la vez: la 301 falla enseguida y la 302 tarda; al terminar la 302, no se consulta la 303.
    const { service, check } = serviceWith({
      rooms: fiveRooms,
      blocked: [],
      concurrency: 2,
      maintenance: async (roomId) => {
        if (roomId === fiveRooms[0].id) {
          throw new BusinessError(
            'MAINTENANCE_CHECK_UNAVAILABLE',
            'sin calendario',
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
        return free(roomId);
      },
    });

    await expect(service.check(byCategory())).rejects.toMatchObject({
      errorCode: 'MAINTENANCE_CHECK_UNAVAILABLE',
    });
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(check).toHaveBeenCalledTimes(2);
  });
});
