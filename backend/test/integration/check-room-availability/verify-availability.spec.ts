import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  MaintenanceCalendar,
  MaintenancePeriod,
} from '../../../src/application/integration/maintenance-calendar.js';
import type { Room } from '../../../src/application/integration/room.js';
import {
  MODULE1_PORT,
  Module1RoomNotFoundError,
  type Module1Port,
} from '../../../src/application/ports/out/module1.port.js';
import {
  VERIFY_AVAILABILITY,
  type VerifyAvailability,
} from '../../../src/application/use-cases/check-room-availability/ports/in/verify-availability.port.js';
import type {
  ReservationStatus,
  StayStatus,
} from '../../../src/domain/shared/enums.js';
import { TypeOrmReservationRepository } from '../../../src/infrastructure/out/persistence/repositories/reservation.repository.js';
import { aDirectReservation, aDirectRoom } from '../../support/builders.js';
import { integrationEnv, truncateAllTables } from '../support/database.js';

/**
 * Pruebas de integración de `check-room-availability` (T012, escenarios 1 a 7 de la historia 1): los
 * módulos reales de Nest (`CheckRoomAvailabilityModule` con `consult-room-inventory`,
 * `check-view-reservation` y `consult-maintenance-calendar`), PostgreSQL real y el Módulo 1 simulado en
 * su puerto (`MODULE1_PORT`).
 */

/** La estadía que se verifica: la del ejemplo del DTO del plan (dos noches). */
const START = '2026-10-10';
const END = '2026-10-12';

/** Las habitaciones de los ejemplos de `consult-room-inventory` (A2), con un `id` fijo. */
const ROOM_201: Room = {
  id: '3f6c1e2a-8b4d-4c7e-9a1f-2b3c4d5e6f70',
  roomNumber: '201',
  categoryRoom: 'DOBLE',
  maxCapacity: 2,
};
const ROOM_202: Room = {
  id: '7a2d9c4e-1f3b-4e8a-b6c5-0d9e8f7a6b51',
  roomNumber: '202',
  categoryRoom: 'DOBLE',
  maxCapacity: 3,
};

/**
 * El Módulo 1 simulado: las dos habitaciones de `DOBLE` y, por habitación, sus mantenimientos. Como el
 * Módulo 1 real, decide si hay cruce: devuelve los que se solapan con el rango pedido.
 */
class SimulatedModule1 implements Module1Port {
  readonly maintenances = new Map<string, MaintenancePeriod[]>();

  getRoom(roomId: string): Promise<Room> {
    const room = [ROOM_201, ROOM_202].find(
      (candidate) => candidate.id === roomId,
    );
    return room
      ? Promise.resolve(room)
      : Promise.reject(new Module1RoomNotFoundError());
  }

  listRoomsByCategory(categoryRoom: string): Promise<Room[]> {
    return Promise.resolve(
      [ROOM_201, ROOM_202].filter((room) => room.categoryRoom === categoryRoom),
    );
  }

  listRooms(): Promise<Room[]> {
    return Promise.resolve([ROOM_201, ROOM_202]);
  }

  getMaintenances(
    roomId: string,
    startDate: string,
    endDate: string,
  ): Promise<MaintenanceCalendar> {
    const conflicts = (this.maintenances.get(roomId) ?? []).filter(
      (period) =>
        period.maintenanceStart < endDate && period.maintenanceEnd >= startDate,
    );
    return Promise.resolve({
      roomId,
      available: conflicts.length === 0,
      conflicts,
    });
  }
}

describe('VerifyAvailability contra PostgreSQL real y el Módulo 1 simulado (T012)', () => {
  let moduleRef: TestingModule;
  let availability: VerifyAvailability;
  let reservations: TypeOrmReservationRepository;
  let dataSource: DataSource;
  const module1 = new SimulatedModule1();

  /** Guarda una reserva directa con una habitación y devuelve su referencia. */
  async function reserve({
    roomId,
    startDate = START,
    endDate = END,
    status = 'ACTIVE',
    stayStatus = 'EXPECTED',
  }: {
    roomId: string;
    startDate?: string;
    endDate?: string;
    status?: ReservationStatus;
    stayStatus?: StayStatus;
  }): Promise<string> {
    const reservation = aDirectReservation({
      startDate,
      endDate,
      status,
      rooms: [aDirectRoom({ roomId, stayStatus })],
    });
    await reservations.insert(reservation);
    return reservation.reservationRef;
  }

  const checkCategory = (excludeReservationRef?: string) =>
    availability.check({
      startDate: START,
      endDate: END,
      categoryRoom: 'DOBLE',
      excludeReservationRef,
    });

  /** La habitación del resultado, con su disponibilidad y su motivo. */
  async function resultFor(roomId: string, excludeReservationRef?: string) {
    const { rooms } = await checkCategory(excludeReservationRef);
    const found = rooms.find(({ room }) => room.id === roomId);
    if (!found) {
      throw new Error(`La habitación ${roomId} no está en el resultado`);
    }
    return found;
  }

  beforeAll(async () => {
    // AppConfigModule lee el entorno al importarse: los módulos se importan después de asignarlo.
    Object.assign(process.env, { NODE_ENV: 'test', ...integrationEnv() });
    const { AppConfigModule } =
      await import('../../../src/infrastructure/config/app-config.module.js');
    const { PersistenceModule } =
      await import('../../../src/infrastructure/out/persistence/persistence.module.js');
    const { ClockModule } =
      await import('../../../src/infrastructure/out/clock/clock.module.js');
    const { Module1ClientModule } =
      await import('../../../src/infrastructure/out/module1/module1-client.module.js');
    const { CheckRoomAvailabilityModule } =
      await import('../../../src/application/use-cases/check-room-availability/check-room-availability.module.js');
    moduleRef = await Test.createTestingModule({
      imports: [
        AppConfigModule,
        PersistenceModule,
        ClockModule,
        Module1ClientModule,
        CheckRoomAvailabilityModule,
      ],
    })
      .overrideProvider(MODULE1_PORT)
      .useValue(module1)
      .compile();
    availability = moduleRef.get<VerifyAvailability>(VERIFY_AVAILABILITY);
    dataSource = moduleRef.get(DataSource);
    reservations = new TypeOrmReservationRepository(dataSource);
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    module1.maintenances.clear();
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('escenario 1: sin reservas ni mantenimientos, las habitaciones están disponibles', async () => {
    await expect(checkCategory()).resolves.toEqual({
      startDate: START,
      endDate: END,
      rooms: [
        { room: ROOM_201, available: true, reason: null, maintenance: [] },
        { room: ROOM_202, available: true, reason: null, maintenance: [] },
      ],
    });
  });

  it('escenario 2: un mantenimiento que se cruza da MAINTENANCE, con los días de la estadía afectados', async () => {
    module1.maintenances.set(ROOM_201.id, [
      { maintenanceStart: '2026-10-11', maintenanceEnd: '2026-10-14' },
    ]);

    await expect(resultFor(ROOM_201.id)).resolves.toEqual({
      room: ROOM_201,
      available: false,
      reason: 'MAINTENANCE',
      maintenance: [{ overlapStart: '2026-10-11', overlapEnd: '2026-10-11' }],
    });
    await expect(resultFor(ROOM_202.id)).resolves.toMatchObject({
      available: true,
    });
  });

  it('escenario 3: una reserva ACTIVE que se solapa da RESERVED', async () => {
    await reserve({
      roomId: ROOM_201.id,
      startDate: '2026-10-11',
      endDate: '2026-10-13',
    });

    await expect(resultFor(ROOM_201.id)).resolves.toEqual({
      room: ROOM_201,
      available: false,
      reason: 'RESERVED',
      maintenance: [],
    });
  });

  it('escenario 4: una habitación CHECKED_IN de una reserva IN_PROGRESS que se cruza da RESERVED', async () => {
    await reserve({
      roomId: ROOM_201.id,
      startDate: '2026-10-08',
      endDate: '2026-10-11',
      status: 'IN_PROGRESS',
      stayStatus: 'CHECKED_IN',
    });

    await expect(resultFor(ROOM_201.id)).resolves.toMatchObject({
      available: false,
      reason: 'RESERVED',
    });
  });

  it('escenario 5: al modificar las fechas, la propia reserva no bloquea y la habitación queda disponible', async () => {
    const own = await reserve({
      roomId: ROOM_201.id,
      startDate: '2026-10-09',
      endDate: '2026-10-11',
    });

    await expect(resultFor(ROOM_201.id)).resolves.toMatchObject({
      reason: 'RESERVED',
    });
    await expect(resultFor(ROOM_201.id, own)).resolves.toEqual({
      room: ROOM_201,
      available: true,
      reason: null,
      maintenance: [],
    });
  });

  it('escenario 5: excluir la propia reserva no oculta las demás', async () => {
    const own = await reserve({
      roomId: ROOM_201.id,
      startDate: '2026-10-08',
      endDate: START,
    });
    await reserve({
      roomId: ROOM_201.id,
      startDate: '2026-10-11',
      endDate: '2026-10-13',
    });

    await expect(resultFor(ROOM_201.id, own)).resolves.toMatchObject({
      reason: 'RESERVED',
    });
  });

  it.each(['COMPLETED', 'CANCELLED', 'NO_SHOW'] as const)(
    'escenario 6: una reserva solapada en %s no bloquea',
    async (status) => {
      await reserve({ roomId: ROOM_201.id, status });

      await expect(resultFor(ROOM_201.id)).resolves.toMatchObject({
        available: true,
        reason: null,
      });
    },
  );

  it('escenario 6: con solo reservas históricas solapadas, la habitación está disponible', async () => {
    // Una de cada estado, solapadas entre sí y con la estadía: la restricción anti-solape solo cuenta las
    // que bloquean inventario, así que no las impide.
    await reserve({
      roomId: ROOM_201.id,
      startDate: '2026-10-09',
      endDate: '2026-10-11',
      status: 'COMPLETED',
    });
    await reserve({
      roomId: ROOM_201.id,
      startDate: '2026-10-10',
      endDate: '2026-10-12',
      status: 'CANCELLED',
    });
    await reserve({
      roomId: ROOM_201.id,
      startDate: '2026-10-11',
      endDate: '2026-10-13',
      status: 'NO_SHOW',
    });

    await expect(resultFor(ROOM_201.id)).resolves.toMatchObject({
      available: true,
    });
  });

  it.each(['NOT_ARRIVED', 'CHECKED_OUT'] as const)(
    'escenario 7: una habitación en %s dentro de una reserva IN_PROGRESS ya no bloquea',
    async (stayStatus) => {
      await reserve({
        roomId: ROOM_201.id,
        status: 'IN_PROGRESS',
        stayStatus,
      });

      await expect(resultFor(ROOM_201.id)).resolves.toMatchObject({
        available: true,
        reason: null,
      });
    },
  );

  it('por roomId, la misma verificación sobre esa sola habitación', async () => {
    await reserve({ roomId: ROOM_202.id });

    await expect(
      availability.check({
        startDate: START,
        endDate: END,
        roomId: ROOM_202.id,
      }),
    ).resolves.toEqual({
      startDate: START,
      endDate: END,
      rooms: [
        {
          room: ROOM_202,
          available: false,
          reason: 'RESERVED',
          maintenance: [],
        },
      ],
    });
  });
});
