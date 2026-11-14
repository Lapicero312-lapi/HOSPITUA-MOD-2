import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Room } from '../../../../../src/application/integration/room.js';
import {
  ChannexRateLimitedError,
  ChannexRejectedError,
  ChannexUnauthorizedError,
  ChannexUnavailableError,
  type ChannexPort,
  type ChannexRoomType,
} from '../../../../../src/application/ports/out/channex.port.js';
import type { Clock } from '../../../../../src/application/ports/out/clock.js';
import type { OtaRoomTypeMappingRepository } from '../../../../../src/application/ports/out/ota-room-type-mapping.repository.js';
import type { ConsultRoomInventory } from '../../../../../src/application/use-cases/consult-room-inventory/ports/in/consult-room-inventory.port.js';
import {
  MAX_ROOM_TYPES,
  SyncRoomTypesService,
} from '../../../../../src/application/use-cases/configure-ota/sync-room-types.service.js';
import type { ManageOta } from '../../../../../src/application/use-cases/register-ota-information-commission/ports/in/manage-ota.port.js';
import type { OtaConnectionTracker } from '../../../../../src/application/use-cases/register-ota-information-commission/ports/in/ota-connection-tracker.port.js';
import type { OtaRoomTypeMapping } from '../../../../../src/domain/ota/ota-room-type-mapping.js';
import { BusinessError } from '../../../../../src/domain/shared/business-error.js';
import { anOta } from '../../../../support/builders.js';

const NOW = new Date('2026-11-14T08:00:00.000Z');
const BOOKING_ID = 'b0000000-0000-4000-8000-000000000001';

/** Una habitación vendible del Módulo 1. */
const room = (
  roomNumber: string,
  categoryRoom: string,
  maxCapacity: number,
): Room => ({
  id: `00000000-0000-4000-8000-000000000${roomNumber}`,
  roomNumber,
  categoryRoom,
  maxCapacity,
});

/** La 201, la 202 y la 203 de `DOBLE`, de 2 personas: el escenario 1 de la historia 2. */
const THREE_DOUBLES = [
  room('201', 'DOBLE', 2),
  room('202', 'DOBLE', 2),
  room('203', 'DOBLE', 2),
];

const roomType = (id: string, title: string): ChannexRoomType => ({
  id,
  title,
  defaultOccupancy: 2,
});

const mapping = (
  categoryRoom: string,
  countOfRooms: number,
  occupancy: number,
  channexRoomTypeId = `rt-${categoryRoom}`,
): OtaRoomTypeMapping => ({
  channexRoomTypeId,
  categoryRoom,
  countOfRooms,
  occupancy,
});

/** El servicio con el Módulo 1, Channex y la relación simulados. */
function serviceWith({
  rooms = THREE_DOUBLES as Room[] | Error,
  roomTypes = [] as ChannexRoomType[] | Error,
  mappings = [] as OtaRoomTypeMapping[],
} = {}) {
  const inventory = {
    listAll: vi.fn(() =>
      rooms instanceof Error ? Promise.reject(rooms) : Promise.resolve(rooms),
    ),
  };
  let created = 0;
  const channex = {
    listRoomTypes: vi.fn(() =>
      roomTypes instanceof Error
        ? Promise.reject(roomTypes)
        : Promise.resolve(roomTypes),
    ),
    createRoomType: vi.fn((input: { title: string }) => {
      created += 1;
      return Promise.resolve(roomType(`new-${created}`, input.title));
    }),
    updateRoomType: vi.fn(() => Promise.resolve()),
  };
  const repository = {
    findAll: vi.fn(() => Promise.resolve(mappings)),
    upsert: vi.fn(() => Promise.resolve()),
  };
  const otas = {
    register: vi.fn(() => Promise.resolve(anOta({ id: BOOKING_ID }))),
  };
  const connection = { markDisconnected: vi.fn(() => Promise.resolve()) };
  const clock = { now: () => NOW, today: () => '2026-11-14' } as Clock;
  const service = new SyncRoomTypesService(
    inventory as unknown as ConsultRoomInventory,
    channex as unknown as ChannexPort,
    repository as unknown as OtaRoomTypeMappingRepository,
    otas as unknown as ManageOta,
    connection as unknown as OtaConnectionTracker,
    clock,
  );
  return { service, inventory, channex, repository, otas, connection };
}

describe('SyncRoomTypes (C1 de configure-ota, T007)', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {
      /* la prueba revisa lo que se registra */
    });
    error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {
      /* la prueba revisa lo que se registra */
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('paso 3: por cada categoría', () => {
    it('escenario 1: sin relación ni tipo, crea "DOBLE" con 3 habitaciones y 2 adultos (A2) y guarda la relación', async () => {
      const { service, channex, repository } = serviceWith();

      await expect(service.sync()).resolves.toEqual({
        status: 'SYNCED',
        created: ['DOBLE'],
      });
      expect(channex.createRoomType).toHaveBeenCalledWith({
        title: 'DOBLE',
        countOfRooms: 3,
        occupancy: 2,
      });
      expect(repository.upsert).toHaveBeenCalledWith(
        mapping('DOBLE', 3, 2, 'new-1'),
      );
    });

    it('con relación y la misma cantidad y capacidad, no llama a Channex ni guarda nada', async () => {
      const { service, channex, repository } = serviceWith({
        roomTypes: [roomType('rt-DOBLE', 'DOBLE')],
        mappings: [mapping('DOBLE', 3, 2)],
      });

      await expect(service.sync()).resolves.toEqual({
        status: 'SYNCED',
        created: [],
      });
      expect(channex.createRoomType).not.toHaveBeenCalled();
      expect(channex.updateRoomType).not.toHaveBeenCalled();
      expect(repository.upsert).not.toHaveBeenCalled();
    });

    it('escenario 2: con una habitación más, actualiza el tipo a 4 (A3) y la relación', async () => {
      const { service, channex, repository } = serviceWith({
        rooms: [...THREE_DOUBLES, room('204', 'DOBLE', 2)],
        roomTypes: [roomType('rt-DOBLE', 'DOBLE')],
        mappings: [mapping('DOBLE', 3, 2)],
      });

      await expect(service.sync()).resolves.toEqual({
        status: 'SYNCED',
        created: [],
      });
      expect(channex.updateRoomType).toHaveBeenCalledWith('rt-DOBLE', {
        title: 'DOBLE',
        countOfRooms: 4,
        occupancy: 2,
      });
      expect(repository.upsert).toHaveBeenCalledWith(mapping('DOBLE', 4, 2));
    });

    it('con otra capacidad (la mayor de la categoría), también actualiza', async () => {
      const { service, channex } = serviceWith({
        rooms: [room('201', 'DOBLE', 2), room('202', 'DOBLE', 3)],
        roomTypes: [roomType('rt-DOBLE', 'DOBLE')],
        mappings: [mapping('DOBLE', 2, 2)],
      });

      await service.sync();

      expect(channex.updateRoomType).toHaveBeenCalledWith('rt-DOBLE', {
        title: 'DOBLE',
        countOfRooms: 2,
        occupancy: 3,
      });
    });

    it('sin relación pero con un tipo creado a mano: lo adopta enviándole lo del Módulo 1 (A3) y guarda lo enviado', async () => {
      const { service, channex, repository } = serviceWith({
        roomTypes: [roomType('manual', 'DOBLE')],
      });

      await expect(service.sync()).resolves.toEqual({
        status: 'SYNCED',
        created: [],
      });
      expect(channex.createRoomType).not.toHaveBeenCalled();
      expect(channex.updateRoomType).toHaveBeenCalledWith('manual', {
        title: 'DOBLE',
        countOfRooms: 3,
        occupancy: 2,
      });
      expect(repository.upsert).toHaveBeenCalledWith(
        mapping('DOBLE', 3, 2, 'manual'),
      );
    });

    it('dos tipos a mano con el mismo nombre: adopta el primero y lo registra en el log', async () => {
      const { service, channex } = serviceWith({
        roomTypes: [roomType('first', 'DOBLE'), roomType('second', 'DOBLE')],
      });

      await service.sync();

      expect(channex.updateRoomType).toHaveBeenCalledTimes(1);
      expect(channex.updateRoomType).toHaveBeenCalledWith(
        'first',
        expect.anything(),
      );
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('se usa el first'),
      );
    });

    it('va por las categorías en orden alfabético, cada una con su cantidad y su mayor capacidad', async () => {
      const { service, channex } = serviceWith({
        rooms: [
          room('301', 'SUITE', 4),
          room('201', 'DOBLE', 2),
          room('101', 'SENCILLA', 1),
          room('302', 'SUITE', 3),
        ],
      });

      await expect(service.sync()).resolves.toEqual({
        status: 'SYNCED',
        created: ['DOBLE', 'SENCILLA', 'SUITE'],
      });
      expect(channex.createRoomType.mock.calls.map(([input]) => input)).toEqual(
        [
          { title: 'DOBLE', countOfRooms: 1, occupancy: 2 },
          { title: 'SENCILLA', countOfRooms: 1, occupancy: 1 },
          { title: 'SUITE', countOfRooms: 2, occupancy: 4 },
        ],
      );
    });
  });

  it('escenario 3, paso 4: una categoría con relación sin habitaciones no se borra ni se actualiza, y queda en el log', async () => {
    const { service, channex, repository } = serviceWith({
      roomTypes: [roomType('rt-DOBLE', 'DOBLE'), roomType('rt-SUITE', 'SUITE')],
      mappings: [mapping('DOBLE', 3, 2), mapping('SUITE', 2, 4)],
    });

    await expect(service.sync()).resolves.toEqual({
      status: 'SYNCED',
      created: [],
    });
    expect(channex.updateRoomType).not.toHaveBeenCalled();
    expect(repository.upsert).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'La categoría SUITE ya no tiene habitaciones vendibles',
      ),
    );
  });

  describe('paso 5: el tope de 20 tipos por propiedad', () => {
    const fullProperty = (count: number) =>
      Array.from({ length: count }, (_, i) =>
        roomType(`rt-${i}`, `OTRA-${String(i).padStart(2, '0')}`),
      );

    it(`con ${MAX_ROOM_TYPES} tipos (contando los sin habitaciones), una categoría nueva no se crea y queda en el log`, async () => {
      const { service, channex, repository } = serviceWith({
        roomTypes: fullProperty(MAX_ROOM_TYPES),
      });

      await expect(service.sync()).resolves.toEqual({
        status: 'SYNCED',
        created: [],
      });
      expect(channex.createRoomType).not.toHaveBeenCalled();
      expect(repository.upsert).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining('No se crea el tipo de habitación de DOBLE'),
      );
    });

    it('cuenta los que crea la misma sincronización: con 19, crea una y la siguiente ya no', async () => {
      const { service, channex } = serviceWith({
        rooms: [room('201', 'DOBLE', 2), room('301', 'SUITE', 4)],
        roomTypes: fullProperty(MAX_ROOM_TYPES - 1),
      });

      await expect(service.sync()).resolves.toEqual({
        status: 'SYNCED',
        created: ['DOBLE'],
      });
      expect(channex.createRoomType).toHaveBeenCalledTimes(1);
    });

    it('adoptar o actualizar no cuenta contra el tope', async () => {
      const { service, channex } = serviceWith({
        roomTypes: [
          ...fullProperty(MAX_ROOM_TYPES - 1),
          roomType('manual', 'DOBLE'),
        ],
      });

      await service.sync();

      expect(channex.updateRoomType).toHaveBeenCalledWith(
        'manual',
        expect.anything(),
      );
    });
  });

  describe('escenario 4: Módulo 1 o Channex caídos', () => {
    it('el Módulo 1 no responde (INVENTORY_UNAVAILABLE): no llama a Channex y queda NOT_SYNCED', async () => {
      const { service, channex, repository } = serviceWith({
        rooms: new BusinessError(
          'INVENTORY_UNAVAILABLE',
          'No se pudo consultar el inventario.',
        ),
      });

      await expect(service.sync()).resolves.toEqual({
        status: 'NOT_SYNCED',
        reason: 'INVENTORY_UNAVAILABLE',
      });
      expect(channex.listRoomTypes).not.toHaveBeenCalled();
      expect(repository.upsert).not.toHaveBeenCalled();
    });

    it.each<[string, Error, string]>([
      [
        '5xx o sin respuesta',
        new ChannexUnavailableError('503'),
        'CHANNEX_UNAVAILABLE',
      ],
      ['429', new ChannexRateLimitedError(), 'CHANNEX_429'],
      ['otro 4xx', new ChannexRejectedError(404, null), 'CHANNEX_404'],
    ])(
      'Channex responde %s al leer los tipos (A1): nada cambia y queda NOT_SYNCED',
      async (_case, failure, reason) => {
        const { service, channex, repository } = serviceWith({
          roomTypes: failure,
        });

        await expect(service.sync()).resolves.toEqual({
          status: 'NOT_SYNCED',
          reason,
        });
        expect(channex.createRoomType).not.toHaveBeenCalled();
        expect(repository.upsert).not.toHaveBeenCalled();
      },
    );

    it.each<[string, Error, string]>([
      [
        '5xx o sin respuesta',
        new ChannexUnavailableError('timeout'),
        'CHANNEX_UNAVAILABLE',
      ],
      ['429', new ChannexRateLimitedError(), 'CHANNEX_429'],
    ])(
      'Channex responde %s a mitad: se detiene, lo ya confirmado queda guardado y lo demás espera',
      async (_case, failure, reason) => {
        const { service, channex, repository } = serviceWith({
          rooms: [
            room('201', 'DOBLE', 2),
            room('101', 'SENCILLA', 1),
            room('301', 'SUITE', 4),
          ],
        });
        channex.createRoomType
          .mockImplementationOnce(() =>
            Promise.resolve(roomType('new-DOBLE', 'DOBLE')),
          )
          .mockImplementationOnce(() => Promise.reject(failure));

        await expect(service.sync()).resolves.toEqual({
          status: 'NOT_SYNCED',
          reason,
        });
        expect(channex.createRoomType).toHaveBeenCalledTimes(2);
        expect(repository.upsert).toHaveBeenCalledTimes(1);
        expect(repository.upsert).toHaveBeenCalledWith(
          mapping('DOBLE', 1, 2, 'new-DOBLE'),
        );
      },
    );
  });

  it.each([401, 403])(
    'Channex responde %s: la agencia pasa a DISCONNECTED y se detiene',
    async (status) => {
      const { service, channex, repository, connection } = serviceWith({
        rooms: [room('201', 'DOBLE', 2), room('301', 'SUITE', 4)],
      });
      channex.createRoomType.mockRejectedValueOnce(
        new ChannexUnauthorizedError(status),
      );

      await expect(service.sync()).resolves.toEqual({
        status: 'NOT_SYNCED',
        reason: `CHANNEX_${status}`,
      });
      expect(connection.markDisconnected).toHaveBeenCalledWith(BOOKING_ID, NOW);
      expect(channex.createRoomType).toHaveBeenCalledTimes(1);
      expect(repository.upsert).not.toHaveBeenCalled();
    },
  );

  it('un 422 (por ejemplo, bajar la capacidad de un tipo mapeado a Booking) descarta esa categoría y sigue con las demás', async () => {
    const { service, channex, repository } = serviceWith({
      rooms: [room('201', 'DOBLE', 1), room('301', 'SUITE', 4)],
      roomTypes: [roomType('rt-DOBLE', 'DOBLE')],
      mappings: [mapping('DOBLE', 1, 2)],
    });
    channex.updateRoomType.mockRejectedValueOnce(
      new ChannexRejectedError(422, 'validation_error'),
    );

    await expect(service.sync()).resolves.toEqual({
      status: 'SYNCED',
      created: ['SUITE'],
    });
    expect(repository.upsert).toHaveBeenCalledTimes(1);
    expect(repository.upsert).toHaveBeenCalledWith(
      mapping('SUITE', 1, 4, 'new-1'),
    );
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining(
        'Channex rechazó actualizar el tipo de habitación de DOBLE (422 validation_error)',
      ),
    );
  });

  it('una categoría nueva que Channex rechaza (422) no cuenta como creada ni contra el tope', async () => {
    const { service, channex } = serviceWith({
      rooms: [room('201', 'DOBLE', 2), room('301', 'SUITE', 4)],
      roomTypes: Array.from({ length: MAX_ROOM_TYPES - 1 }, (_, i) =>
        roomType(`rt-${i}`, `OTRA-${i}`),
      ),
    });
    channex.createRoomType.mockRejectedValueOnce(
      new ChannexRejectedError(422, null),
    );

    await expect(service.sync()).resolves.toEqual({
      status: 'SYNCED',
      created: ['SUITE'],
    });
    expect(channex.createRoomType).toHaveBeenCalledTimes(2);
  });

  it('un error que no es de Channex ni del Módulo 1 (la base no responde) sale para quien llama', async () => {
    const { service, repository } = serviceWith();
    repository.upsert.mockRejectedValueOnce(new Error('la base no responde'));

    await expect(service.sync()).rejects.toThrow('la base no responde');
  });
});
