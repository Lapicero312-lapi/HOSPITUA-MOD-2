import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Room } from '../../../../../src/application/integration/room.js';
import type { MaintenanceCheck } from '../../../../../src/application/integration/maintenance-calendar.js';
import type {
  AriPendingChange,
  AriPendingChangeRepository,
} from '../../../../../src/application/ports/out/ari-pending-change.repository.js';
import {
  type AvailabilityRange,
  type ChannexPort,
  ChannexRateLimitedError,
  ChannexRejectedError,
  ChannexUnauthorizedError,
  ChannexUnavailableError,
} from '../../../../../src/application/ports/out/channex.port.js';
import type { Clock } from '../../../../../src/application/ports/out/clock.js';
import type { NightBlockingRooms } from '../../../../../src/application/ports/out/reservation-query.port.js';
import type { OtaRoomTypeMappingRepository } from '../../../../../src/application/ports/out/ota-room-type-mapping.repository.js';
import type { ReservationLookup } from '../../../../../src/application/use-cases/check-view-reservation/ports/in/reservation-lookup.port.js';
import { PublishPendingAvailabilityService } from '../../../../../src/application/use-cases/configure-ota/publish-pending-availability.service.js';
import type { ConsultMaintenanceCalendar } from '../../../../../src/application/use-cases/consult-maintenance-calendar/ports/in/consult-maintenance-calendar.port.js';
import type { ConsultRoomInventory } from '../../../../../src/application/use-cases/consult-room-inventory/ports/in/consult-room-inventory.port.js';
import type { ManageOta } from '../../../../../src/application/use-cases/register-ota-information-commission/ports/in/manage-ota.port.js';
import type { OtaConnectionTracker } from '../../../../../src/application/use-cases/register-ota-information-commission/ports/in/ota-connection-tracker.port.js';
import type { OtaRoomTypeMapping } from '../../../../../src/domain/ota/ota-room-type-mapping.js';
import { BusinessError } from '../../../../../src/domain/shared/business-error.js';
import { anOta } from '../../../../support/builders.js';

const TODAY = '2026-11-10';
const NOW = new Date('2026-11-10T15:00:00.000Z');
const DOBLE_TYPE = '994d1375-dbbd-4072-8724-b2ab32ce781b';
const SUITE_TYPE = '1e2d3c4b-5a69-4788-9a0b-1c2d3e4f5a6b';

const room = (roomNumber: string, categoryRoom = 'DOBLE'): Room => ({
  id: `room-${roomNumber}`,
  roomNumber,
  categoryRoom,
  maxCapacity: 2,
});
const R201 = room('201');
const R202 = room('202');
const R203 = room('203');
const S305 = room('305', 'SUITE');

const mark = (
  id: string,
  dateFrom: string,
  dateTo: string,
  categoryRoom = 'DOBLE',
): AriPendingChange => ({ id, categoryRoom, dateFrom, dateTo });

const mapping = (
  categoryRoom: string,
  channexRoomTypeId: string,
  countOfRooms = 3,
): OtaRoomTypeMapping => ({
  channexRoomTypeId,
  categoryRoom,
  countOfRooms,
  occupancy: 2,
});

type Options = {
  marks?: AriPendingChange[];
  mappings?: OtaRoomTypeMapping[];
  rooms?: Record<string, Room[] | Error>;
  /** Por categoría, las ocupadas de cada noche. */
  blocking?: Record<string, Record<string, string[]>>;
  /** Por habitación, sus cruces (días incluidos) o un error. */
  maintenance?: Record<string, [string, string][] | Error>;
  push?: () => Promise<{ warnings: string[] }>;
};

function aService(options: Options = {}) {
  const findAll = vi.fn(() => Promise.resolve(options.marks ?? []));
  const deleteByIds = vi.fn((_ids: string[]) => Promise.resolve());
  const findAllMappings = vi.fn(() =>
    Promise.resolve(
      options.mappings ?? [
        mapping('DOBLE', DOBLE_TYPE),
        mapping('SUITE', SUITE_TYPE, 1),
      ],
    ),
  );
  const rooms = options.rooms ?? { DOBLE: [R201, R202, R203], SUITE: [S305] };
  const byCategory = vi.fn((categoryRoom: string) => {
    const found = rooms[categoryRoom] ?? [];
    return found instanceof Error
      ? Promise.reject(found)
      : Promise.resolve(found);
  });
  const blockingRoomsByCategory = vi.fn(
    (categoryRoom: string, dateFrom: string, dateTo: string) => {
      const nights: NightBlockingRooms[] = [];
      for (let day = dateFrom; day < dateTo; day = next(day)) {
        nights.push({
          date: day,
          roomIds: options.blocking?.[categoryRoom]?.[day] ?? [],
        });
      }
      return Promise.resolve(nights);
    },
  );
  const check = vi.fn(
    (
      roomId: string,
      _start: string,
      _end: string,
    ): Promise<MaintenanceCheck> => {
      const found = options.maintenance?.[roomId] ?? [];
      if (found instanceof Error) {
        return Promise.reject(found);
      }
      return Promise.resolve({
        roomId,
        available: found.length === 0,
        conflicts: found.map(([overlapStart, overlapEnd]) => ({
          maintenanceStart: overlapStart,
          maintenanceEnd: overlapEnd,
          overlapStart,
          overlapEnd,
        })),
      });
    },
  );
  const pushAvailability = vi.fn(
    (_values: AvailabilityRange[]) =>
      options.push?.() ?? Promise.resolve({ warnings: [] }),
  );
  const register = vi.fn(() => Promise.resolve(anOta({ id: 'ota-1' })));
  const markDisconnected = vi.fn(() => Promise.resolve());
  const clock: Clock = { today: () => TODAY, now: () => NOW };

  const service = new PublishPendingAvailabilityService(
    { findAll, deleteByIds } as unknown as AriPendingChangeRepository,
    { findAll: findAllMappings } as unknown as OtaRoomTypeMappingRepository,
    { byCategory } as unknown as ConsultRoomInventory,
    { blockingRoomsByCategory } as unknown as ReservationLookup,
    { check } as unknown as ConsultMaintenanceCalendar,
    2,
    { pushAvailability } as unknown as ChannexPort,
    { register } as unknown as ManageOta,
    { markDisconnected } as unknown as OtaConnectionTracker,
    clock,
  );
  return {
    service,
    findAll,
    deleteByIds,
    byCategory,
    blockingRoomsByCategory,
    check,
    pushAvailability,
    markDisconnected,
  };
}

function next(date: string): string {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 1);
  return day.toISOString().slice(0, 10);
}

/** Lo que se envió en el A4. */
const sent = (deps: ReturnType<typeof aService>) =>
  deps.pushAvailability.mock.calls[0][0];
const deleted = (deps: ReturnType<typeof aService>) =>
  deps.deleteByIds.mock.calls.flatMap(([ids]) => ids).sort();

describe('PublishPendingAvailability (plan de configure-ota, B3; T010)', () => {
  let warnings: string[];
  let errors: string[];

  beforeEach(() => {
    warnings = [];
    errors = [];
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(
      (message: unknown) => {
        warnings.push(String(message));
      },
    );
    vi.spyOn(Logger.prototype, 'error').mockImplementation(
      (message: unknown) => {
        errors.push(String(message));
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sin marcas: NOTHING_PENDING, sin consultar nada ni llamar a Channex', async () => {
    const deps = aService();

    expect(await deps.service.publish()).toEqual({ status: 'NOTHING_PENDING' });
    expect(deps.byCategory).not.toHaveBeenCalled();
    expect(deps.pushAvailability).not.toHaveBeenCalled();
  });

  describe('la disponibilidad de cada noche (regla 2)', () => {
    it('vendibles menos las ocupadas o en mantenimiento, cada habitación una vez, solo las noches marcadas, en un solo A4', async () => {
      const deps = aService({
        marks: [
          mark('m1', '2026-11-12', '2026-11-14'),
          mark('m2', '2026-11-16', '2026-11-17'),
        ],
        blocking: {
          DOBLE: { '2026-11-12': [R201.id], '2026-11-13': [R201.id] },
        },
        // La 201 también en mantenimiento el 13 (cuenta una vez) y la 202 el 16.
        maintenance: {
          [R201.id]: [['2026-11-13', '2026-11-13']],
          [R202.id]: [['2026-11-16', '2026-11-16']],
        },
      });

      expect(await deps.service.publish()).toEqual({
        status: 'SENT',
        categories: ['DOBLE'],
        marks: 2,
      });
      expect(deps.pushAvailability).toHaveBeenCalledTimes(1);
      expect(sent(deps)).toEqual([
        {
          roomTypeId: DOBLE_TYPE,
          dateFrom: '2026-11-12',
          dateTo: '2026-11-13',
          availability: 2,
        },
        {
          roomTypeId: DOBLE_TYPE,
          dateFrom: '2026-11-16',
          dateTo: '2026-11-16',
          availability: 2,
        },
      ]);
      // Las ocupadas y los mantenimientos se consultan una vez, de la primera a la última noche marcada.
      expect(deps.blockingRoomsByCategory).toHaveBeenCalledExactlyOnceWith(
        'DOBLE',
        '2026-11-12',
        '2026-11-17',
      );
      expect(deps.check).toHaveBeenCalledTimes(3);
      expect(deps.check).toHaveBeenCalledWith(
        R201.id,
        '2026-11-12',
        '2026-11-17',
      );
      expect(deleted(deps)).toEqual(['m1', 'm2']);
    });

    it('las marcas que se cruzan se unen: cada noche se calcula y se envía una vez', async () => {
      const deps = aService({
        marks: [
          mark('m1', '2026-11-12', '2026-11-14'),
          mark('m2', '2026-11-13', '2026-11-15'),
        ],
      });

      await deps.service.publish();

      expect(sent(deps)).toEqual([
        {
          roomTypeId: DOBLE_TYPE,
          dateFrom: '2026-11-12',
          dateTo: '2026-11-14',
          availability: 3,
        },
      ]);
    });

    it('nunca menos de 0 ni más del countOfRooms del tipo (regla 8)', async () => {
      const deps = aService({
        marks: [
          mark('m1', '2026-11-12', '2026-11-13'),
          mark('m2', '2026-11-12', '2026-11-13', 'SUITE'),
        ],
        // DOBLE con 3 vendibles pero el tipo registrado con 2; la SUITE, con su única habitación ocupada y
        // en mantenimiento.
        mappings: [
          mapping('DOBLE', DOBLE_TYPE, 2),
          mapping('SUITE', SUITE_TYPE, 1),
        ],
        blocking: { SUITE: { '2026-11-12': [S305.id] } },
        maintenance: { [S305.id]: [['2026-11-12', '2026-11-12']] },
      });

      await deps.service.publish();

      expect(sent(deps)).toEqual([
        {
          roomTypeId: DOBLE_TYPE,
          dateFrom: '2026-11-12',
          dateTo: '2026-11-12',
          availability: 2,
        },
        {
          roomTypeId: SUITE_TYPE,
          dateFrom: '2026-11-12',
          dateTo: '2026-11-12',
          availability: 0,
        },
      ]);
    });

    it('una ocupada que ya no es vendible no se resta', async () => {
      const deps = aService({
        marks: [mark('m1', '2026-11-12', '2026-11-13')],
        blocking: { DOBLE: { '2026-11-12': ['room-999'] } },
      });

      await deps.service.publish();

      expect(sent(deps)[0].availability).toBe(3);
    });
  });

  describe('lo que no se envía', () => {
    it('sin fechas pasadas (FR-008): las noches de antes de hoy no se envían, y una marca toda en el pasado se borra sin enviar', async () => {
      const deps = aService({
        marks: [
          mark('m1', '2026-11-08', '2026-11-11'),
          mark('m2', '2026-11-01', '2026-11-05', 'SUITE'),
        ],
      });

      expect(await deps.service.publish()).toEqual({
        status: 'SENT',
        categories: ['DOBLE'],
        marks: 2,
      });
      expect(sent(deps)).toEqual([
        {
          roomTypeId: DOBLE_TYPE,
          dateFrom: '2026-11-10',
          dateTo: '2026-11-10',
          availability: 3,
        },
      ]);
      expect(deleted(deps)).toEqual(['m1', 'm2']);
    });

    it('una categoría sin tipo en Channex: sus marcas se borran y se registra; las demás se envían', async () => {
      const deps = aService({
        marks: [
          mark('m1', '2026-11-12', '2026-11-13'),
          mark('m2', '2026-11-12', '2026-11-13', 'FAMILIAR'),
        ],
      });

      await deps.service.publish();

      expect(sent(deps).map(({ roomTypeId }) => roomTypeId)).toEqual([
        DOBLE_TYPE,
      ]);
      expect(deleted(deps)).toEqual(['m1', 'm2']);
      expect(warnings.join()).toContain('FAMILIAR');
    });

    it.each([
      [
        'el inventario',
        {
          rooms: {
            DOBLE: [R201],
            SUITE: new BusinessError('INVENTORY_UNAVAILABLE', 'x'),
          },
        },
      ],
      [
        'un calendario de mantenimientos',
        {
          maintenance: {
            [S305.id]: new BusinessError('MAINTENANCE_CHECK_UNAVAILABLE', 'x'),
          },
        },
      ],
    ] as const)(
      'el Módulo 1 no responde con %s de una categoría: sus marcas se conservan y las demás se envían',
      async (_case, failure) => {
        const deps = aService({
          marks: [
            mark('m1', '2026-11-12', '2026-11-13'),
            mark('m2', '2026-11-12', '2026-11-13', 'SUITE'),
          ],
          ...(failure as Options),
        });

        expect(await deps.service.publish()).toMatchObject({
          status: 'SENT',
          categories: ['DOBLE'],
        });
        expect(sent(deps).map(({ roomTypeId }) => roomTypeId)).toEqual([
          DOBLE_TYPE,
        ]);
        expect(deleted(deps)).toEqual(['m1']);
      },
    );

    it('si el Módulo 1 no responde para ninguna: NOT_SENT con su código, sin llamar a Channex ni borrar nada', async () => {
      const deps = aService({
        marks: [mark('m1', '2026-11-12', '2026-11-13')],
        rooms: { DOBLE: new BusinessError('INVENTORY_UNAVAILABLE', 'x') },
      });

      expect(await deps.service.publish()).toEqual({
        status: 'NOT_SENT',
        reason: 'INVENTORY_UNAVAILABLE',
      });
      expect(deps.pushAvailability).not.toHaveBeenCalled();
      expect(deps.deleteByIds).not.toHaveBeenCalled();
    });

    it.each([
      [
        'el inventario (INVALID_CATEGORY)',
        { rooms: { DOBLE: new BusinessError('INVALID_CATEGORY', 'x') } },
        'INVALID_CATEGORY',
      ],
      [
        'un calendario de mantenimientos (INVALID_ROOM_ID)',
        {
          rooms: { DOBLE: [R201] },
          maintenance: { [R201.id]: new BusinessError('INVALID_ROOM_ID', 'x') },
        },
        'INVALID_ROOM_ID',
      ],
    ])(
      'otro error de negocio de %s no es "el Módulo 1 no respondió": se propaga, sin llamar a Channex ni borrar nada',
      async (_from, options, code) => {
        const deps = aService({
          marks: [mark('m1', '2026-11-12', '2026-11-13')],
          ...options,
        });

        await expect(deps.service.publish()).rejects.toMatchObject({
          errorCode: code,
        });
        expect(deps.pushAvailability).not.toHaveBeenCalled();
        expect(deps.deleteByIds).not.toHaveBeenCalled();
      },
    );

    it('un error inesperado al calcular se propaga', async () => {
      const deps = aService({
        marks: [mark('m1', '2026-11-12', '2026-11-13')],
        rooms: { DOBLE: new Error('inesperado') },
      });

      await expect(deps.service.publish()).rejects.toThrow('inesperado');
    });
  });

  describe('la respuesta de Channex', () => {
    const pending = [mark('m1', '2026-11-12', '2026-11-13')];

    it('200 con warnings: borra las marcas enviadas y registra cada aviso', async () => {
      const deps = aService({
        marks: pending,
        push: () => Promise.resolve({ warnings: ['fecha fuera de rango'] }),
      });

      expect((await deps.service.publish()).status).toBe('SENT');
      expect(deleted(deps)).toEqual(['m1']);
      expect(warnings.join()).toContain('fecha fuera de rango');
    });

    it('401 o 403: la agencia pasa a DISCONNECTED y las marcas se conservan', async () => {
      const deps = aService({
        marks: pending,
        push: () => Promise.reject(new ChannexUnauthorizedError(401)),
      });

      expect(await deps.service.publish()).toEqual({
        status: 'NOT_SENT',
        reason: 'CHANNEX_401',
      });
      expect(deps.markDisconnected).toHaveBeenCalledExactlyOnceWith(
        'ota-1',
        NOW,
      );
      expect(deps.deleteByIds).not.toHaveBeenCalled();
    });

    it.each([
      ['429', () => new ChannexRateLimitedError(), 'CHANNEX_429'],
      [
        'sin respuesta',
        () => new ChannexUnavailableError('respondió 503'),
        'CHANNEX_UNAVAILABLE',
      ],
    ])(
      '%s: las marcas se conservan para el siguiente ciclo',
      async (_case, error, reason) => {
        const deps = aService({
          marks: pending,
          push: () => Promise.reject(error()),
        });

        expect(await deps.service.publish()).toEqual({
          status: 'NOT_SENT',
          reason,
        });
        expect(deps.deleteByIds).not.toHaveBeenCalled();
        expect(deps.markDisconnected).not.toHaveBeenCalled();
      },
    );

    it('422: se registra y se borran las marcas enviadas, para no repetir un error permanente', async () => {
      const deps = aService({
        marks: pending,
        push: () =>
          Promise.reject(new ChannexRejectedError(422, 'validation_error')),
      });

      expect(await deps.service.publish()).toEqual({
        status: 'NOT_SENT',
        reason: 'CHANNEX_422',
      });
      expect(deleted(deps)).toEqual(['m1']);
      expect(errors.join()).toContain('422');
    });

    it('un error inesperado de Channex se propaga sin borrar nada', async () => {
      const deps = aService({
        marks: pending,
        push: () => Promise.reject(new Error('inesperado')),
      });

      await expect(deps.service.publish()).rejects.toThrow('inesperado');
      expect(deps.deleteByIds).not.toHaveBeenCalled();
    });
  });
});
