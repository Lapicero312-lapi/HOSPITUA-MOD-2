import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MaintenanceCheck } from '../../../../../src/application/integration/maintenance-calendar.js';
import type { Room } from '../../../../../src/application/integration/room.js';
import type { AriChange } from '../../../../../src/application/ports/out/ari-pending-change.repository.js';
import {
  type AvailabilityRange,
  type ChannexPort,
  ChannexRateLimitedError,
  ChannexRejectedError,
  ChannexUnauthorizedError,
  ChannexUnavailableError,
} from '../../../../../src/application/ports/out/channex.port.js';
import type { ChannexSetupState } from '../../../../../src/application/ports/out/channex-setup-state.js';
import type { Clock } from '../../../../../src/application/ports/out/clock.js';
import type { OtaRoomTypeMappingRepository } from '../../../../../src/application/ports/out/ota-room-type-mapping.repository.js';
import type { NightBlockingRooms } from '../../../../../src/application/ports/out/reservation-query.port.js';
import type {
  Transaction,
  TransactionRunner,
} from '../../../../../src/application/ports/out/transaction.js';
import type { ReservationLookup } from '../../../../../src/application/use-cases/check-view-reservation/ports/in/reservation-lookup.port.js';
import type { AriChangeRecorder } from '../../../../../src/application/use-cases/configure-ota/ports/in/ari-change-recorder.port.js';
import { PublishDailyAvailabilityService } from '../../../../../src/application/use-cases/configure-ota/publish-daily-availability.service.js';
import type { ConsultMaintenanceCalendar } from '../../../../../src/application/use-cases/consult-maintenance-calendar/ports/in/consult-maintenance-calendar.port.js';
import type { ConsultRoomInventory } from '../../../../../src/application/use-cases/consult-room-inventory/ports/in/consult-room-inventory.port.js';
import type { ManageOta } from '../../../../../src/application/use-cases/register-ota-information-commission/ports/in/manage-ota.port.js';
import type { OtaConnectionTracker } from '../../../../../src/application/use-cases/register-ota-information-commission/ports/in/ota-connection-tracker.port.js';
import type { OtaRoomTypeMapping } from '../../../../../src/domain/ota/ota-room-type-mapping.js';
import { BusinessError } from '../../../../../src/domain/shared/business-error.js';
import { anOta } from '../../../../support/builders.js';

const TODAY = '2026-11-10';
const NOW = new Date('2026-11-10T03:00:00.000Z');
const TX = { tx: 'la de las marcas' } as unknown as Transaction;
const DOBLE_TYPE = '994d1375-dbbd-4072-8724-b2ab32ce781b';
const SUITE_TYPE = '1e2d3c4b-5a69-4788-9a0b-1c2d3e4f5a6b';
/** Con `CHANNEX_ARI_DAYS` en 5, para leer los rangos: del 10 al 14 de noviembre. */
const ARI_DAYS = 5;
const END = '2026-11-15';

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
  mappings?: OtaRoomTypeMapping[];
  rooms?: Record<string, Room[] | Error>;
  /** Por categoría, las ocupadas de cada noche. */
  blocking?: Record<string, Record<string, string[]>>;
  /** Por habitación, sus cruces (días incluidos). */
  maintenance?: Record<string, [string, string][]>;
  push?: () => Promise<{ warnings: string[] }>;
  ariDays?: number | null;
};

function aService(options: Options = {}) {
  const findAll = vi.fn(() =>
    Promise.resolve(
      options.mappings ?? [
        // Desordenadas a propósito: se envían en orden alfabético.
        mapping('SUITE', SUITE_TYPE, 1),
        mapping('DOBLE', DOBLE_TYPE),
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
  const check = vi.fn((roomId: string): Promise<MaintenanceCheck> =>
    Promise.resolve({
      roomId,
      available: (options.maintenance?.[roomId] ?? []).length === 0,
      conflicts: (options.maintenance?.[roomId] ?? []).map(
        ([overlapStart, overlapEnd]) => ({
          maintenanceStart: overlapStart,
          maintenanceEnd: overlapEnd,
          overlapStart,
          overlapEnd,
        }),
      ),
    }),
  );
  const pushAvailability = vi.fn(
    (_values: AvailabilityRange[]) =>
      options.push?.() ?? Promise.resolve({ warnings: [] }),
  );
  const ariDays = options.ariDays === undefined ? ARI_DAYS : options.ariDays;
  const setup = {
    settings: () =>
      ariDays === null
        ? null
        : {
            baseUrl: 'https://staging.channex.io',
            propertyId: '716305c4-561a-4561-a187-7f5b8aeb5920',
            syncIntervalSeconds: 30,
            ariDays,
          },
  } as unknown as ChannexSetupState;
  const register = vi.fn(() => Promise.resolve(anOta({ id: 'ota-1' })));
  const markDisconnected = vi.fn(() => Promise.resolve());
  const record = vi.fn<AriChangeRecorder['record']>(() => Promise.resolve());
  const run = vi.fn((work: (tx: Transaction) => Promise<unknown>) => work(TX));
  const clock: Clock = { today: () => TODAY, now: () => NOW };

  const service = new PublishDailyAvailabilityService(
    { findAll } as unknown as OtaRoomTypeMappingRepository,
    { byCategory } as unknown as ConsultRoomInventory,
    { blockingRoomsByCategory } as unknown as ReservationLookup,
    { check } as unknown as ConsultMaintenanceCalendar,
    2,
    { pushAvailability } as unknown as ChannexPort,
    setup,
    { register } as unknown as ManageOta,
    { markDisconnected } as unknown as OtaConnectionTracker,
    { record },
    { run } as unknown as TransactionRunner,
    clock,
  );
  return {
    service,
    pushAvailability,
    markDisconnected,
    record,
    run,
    byCategory,
    blockingRoomsByCategory,
    check,
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
/** Las marcas anotadas (en una sola transacción). */
const marked = (deps: ReturnType<typeof aService>): AriChange[] =>
  deps.record.mock.calls.flatMap(([, changes]) => changes);

describe('PublishDailyAvailability (plan de configure-ota, B4; T011)', () => {
  let warnings: string[];
  let errors: string[];

  beforeEach(() => {
    warnings = [];
    errors = [];
    vi.spyOn(Logger.prototype, 'warn').mockImplementation((message) => {
      warnings.push(String(message));
    });
    vi.spyOn(Logger.prototype, 'error').mockImplementation((message) => {
      errors.push(String(message));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sin categorías relacionadas: NOTHING_TO_SEND, sin llamar al Módulo 1 ni a Channex', async () => {
    const deps = aService({ mappings: [] });

    expect(await deps.service.publish()).toEqual({
      status: 'NOTHING_TO_SEND',
    });
    expect(deps.byCategory).not.toHaveBeenCalled();
    expect(deps.pushAvailability).not.toHaveBeenCalled();
  });

  it('todas las categorías, en orden alfabético, de hoy a hoy + CHANNEX_ARI_DAYS, en un solo A4', async () => {
    const deps = aService();

    expect(await deps.service.publish()).toEqual({
      status: 'SENT',
      categories: ['DOBLE', 'SUITE'],
    });

    expect(deps.pushAvailability).toHaveBeenCalledOnce();
    expect(sent(deps)).toEqual([
      {
        roomTypeId: DOBLE_TYPE,
        dateFrom: TODAY,
        dateTo: '2026-11-14',
        availability: 3,
      },
      {
        roomTypeId: SUITE_TYPE,
        dateFrom: TODAY,
        dateTo: '2026-11-14',
        availability: 1,
      },
    ]);
    // Las ocupadas y los mantenimientos se consultan de hoy al día siguiente de la última noche.
    expect(deps.blockingRoomsByCategory).toHaveBeenCalledWith(
      'DOBLE',
      TODAY,
      END,
    );
    expect(deps.check).toHaveBeenCalledWith(R201.id, TODAY, END);
    expect(deps.record).not.toHaveBeenCalled();
  });

  it('el cálculo de B3: una habitación ocupada y en mantenimiento cuenta una vez', async () => {
    const deps = aService({
      mappings: [mapping('DOBLE', DOBLE_TYPE)],
      blocking: { DOBLE: { '2026-11-11': [R201.id], '2026-11-12': [R201.id] } },
      // La 201 ocupada y en mantenimiento el 12 cuenta una vez; la 202 en mantenimiento el 13.
      maintenance: {
        [R201.id]: [['2026-11-12', '2026-11-12']],
        [R202.id]: [['2026-11-13', '2026-11-13']],
      },
    });

    await deps.service.publish();

    expect(sent(deps)).toEqual([
      {
        roomTypeId: DOBLE_TYPE,
        dateFrom: TODAY,
        dateTo: TODAY,
        availability: 3,
      },
      {
        roomTypeId: DOBLE_TYPE,
        dateFrom: '2026-11-11',
        dateTo: '2026-11-13',
        availability: 2,
      },
      {
        roomTypeId: DOBLE_TYPE,
        dateFrom: '2026-11-14',
        dateTo: '2026-11-14',
        availability: 3,
      },
    ]);
  });

  it('nunca más que el countOfRooms del tipo (regla 8)', async () => {
    const deps = aService({ mappings: [mapping('DOBLE', DOBLE_TYPE, 2)] });

    await deps.service.publish();

    expect(sent(deps)).toEqual([
      {
        roomTypeId: DOBLE_TYPE,
        dateFrom: TODAY,
        dateTo: '2026-11-14',
        availability: 2,
      },
    ]);
  });

  it('una categoría relacionada sin habitaciones vendibles se envía con 0', async () => {
    const deps = aService({
      mappings: [mapping('DOBLE', DOBLE_TYPE)],
      rooms: { DOBLE: [] },
    });

    await deps.service.publish();

    expect(sent(deps)).toEqual([
      {
        roomTypeId: DOBLE_TYPE,
        dateFrom: TODAY,
        dateTo: '2026-11-14',
        availability: 0,
      },
    ]);
  });

  it('sin configuración válida de Channex, 90 días', async () => {
    const deps = aService({
      mappings: [mapping('DOBLE', DOBLE_TYPE)],
      ariDays: null,
    });

    await deps.service.publish();

    expect(sent(deps)).toEqual([
      {
        roomTypeId: DOBLE_TYPE,
        dateFrom: TODAY,
        dateTo: '2027-02-07',
        availability: 3,
      },
    ]);
  });

  describe('el Módulo 1 no responde para una categoría', () => {
    it.each(['INVENTORY_UNAVAILABLE', 'MAINTENANCE_CHECK_UNAVAILABLE'])(
      'con %s: las demás se envían y sus noches quedan como marcas',
      async (code) => {
        const deps = aService({
          rooms: {
            DOBLE: new BusinessError(code, 'x'),
            SUITE: [S305],
          },
        });

        expect(await deps.service.publish()).toEqual({
          status: 'SENT',
          categories: ['SUITE'],
        });
        expect(sent(deps).map(({ roomTypeId }) => roomTypeId)).toEqual([
          SUITE_TYPE,
        ]);
        expect(marked(deps)).toEqual([
          { categoryRoom: 'DOBLE', dateFrom: TODAY, dateTo: END },
        ]);
      },
    );

    it('para todas: NOT_SENT con el código, sin llamar a Channex, y todas quedan como marcas', async () => {
      const deps = aService({
        rooms: {
          DOBLE: new BusinessError('INVENTORY_UNAVAILABLE', 'x'),
          SUITE: new BusinessError('INVENTORY_UNAVAILABLE', 'x'),
        },
      });

      expect(await deps.service.publish()).toEqual({
        status: 'NOT_SENT',
        reason: 'INVENTORY_UNAVAILABLE',
      });
      expect(deps.pushAvailability).not.toHaveBeenCalled();
      expect(marked(deps)).toEqual([
        { categoryRoom: 'DOBLE', dateFrom: TODAY, dateTo: END },
        { categoryRoom: 'SUITE', dateFrom: TODAY, dateTo: END },
      ]);
    });

    it('otro error de negocio no es "no responde": sale tal cual, sin marcas', async () => {
      const deps = aService({
        rooms: { DOBLE: new BusinessError('INVALID_CATEGORY', 'x') },
      });

      await expect(deps.service.publish()).rejects.toThrow(BusinessError);
      expect(deps.record).not.toHaveBeenCalled();
    });
  });

  describe('la respuesta de Channex', () => {
    it('200 con warnings: SENT y se registran', async () => {
      const deps = aService({
        push: () => Promise.resolve({ warnings: ['fecha recortada'] }),
      });

      expect((await deps.service.publish()).status).toBe('SENT');
      expect(warnings.some((w) => w.includes('fecha recortada'))).toBe(true);
    });

    it.each([401, 403])(
      '%s: la agencia pasa a DISCONNECTED, NOT_SENT y sin marcas',
      async (status) => {
        const deps = aService({
          push: () => Promise.reject(new ChannexUnauthorizedError(status)),
        });

        expect(await deps.service.publish()).toEqual({
          status: 'NOT_SENT',
          reason: `CHANNEX_${status}`,
        });
        expect(deps.markDisconnected).toHaveBeenCalledExactlyOnceWith(
          'ota-1',
          NOW,
        );
        expect(deps.record).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['429', () => new ChannexRateLimitedError(), 'CHANNEX_429'],
      [
        '5xx o sin respuesta',
        () => new ChannexUnavailableError('respondió 503'),
        'CHANNEX_UNAVAILABLE',
      ],
    ])(
      '%s: NOT_SENT y las noches de las categorías calculadas quedan como marcas',
      async (_case, error, reason) => {
        const deps = aService({ push: () => Promise.reject(error()) });

        expect(await deps.service.publish()).toEqual({
          status: 'NOT_SENT',
          reason,
        });
        expect(marked(deps)).toEqual([
          { categoryRoom: 'DOBLE', dateFrom: TODAY, dateTo: END },
          { categoryRoom: 'SUITE', dateFrom: TODAY, dateTo: END },
        ]);
      },
    );

    it('422: NOT_SENT, se registra y no se reintenta (sin marcas)', async () => {
      const deps = aService({
        push: () =>
          Promise.reject(new ChannexRejectedError(422, 'validation_error')),
      });

      expect(await deps.service.publish()).toEqual({
        status: 'NOT_SENT',
        reason: 'CHANNEX_422',
      });
      expect(deps.record).not.toHaveBeenCalled();
      expect(errors.some((e) => e.includes('validation_error'))).toBe(true);
    });

    it('un error inesperado sale tal cual', async () => {
      const deps = aService({
        push: () => Promise.reject(new Error('inesperado')),
      });

      await expect(deps.service.publish()).rejects.toThrow('inesperado');
    });
  });

  describe('markAllPending', () => {
    it('anota las noches de todas las categorías relacionadas, en una transacción, sin calcular ni enviar', async () => {
      const deps = aService();

      await deps.service.markAllPending();

      expect(deps.run).toHaveBeenCalledOnce();
      expect(deps.record).toHaveBeenCalledExactlyOnceWith(TX, [
        { categoryRoom: 'DOBLE', dateFrom: TODAY, dateTo: END },
        { categoryRoom: 'SUITE', dateFrom: TODAY, dateTo: END },
      ]);
      expect(deps.byCategory).not.toHaveBeenCalled();
      expect(deps.pushAvailability).not.toHaveBeenCalled();
    });

    it('sin categorías relacionadas no abre la transacción', async () => {
      const deps = aService({ mappings: [] });

      await deps.service.markAllPending();

      expect(deps.run).not.toHaveBeenCalled();
    });
  });
});
