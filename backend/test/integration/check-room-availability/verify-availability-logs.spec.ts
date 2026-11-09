import { ConfigService } from '@nestjs/config';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { delay, http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { DataSource } from 'typeorm';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  VERIFY_AVAILABILITY,
  type AvailabilityQuery,
  type VerifyAvailability,
} from '../../../src/application/use-cases/check-room-availability/ports/in/verify-availability.port.js';
import type { EnvironmentVariables } from '../../../src/infrastructure/config/env.validation.js';
import { TypeOrmReservationRepository } from '../../../src/infrastructure/out/persistence/repositories/reservation.repository.js';
import {
  aDirectReservation,
  aDirectRoom,
  aGuest,
} from '../../support/builders.js';
import { ROOM_201, ROOM_202 } from '../../support/rooms.js';
import { captureLogs } from '../support/capture-logs.js';
import { checkRoomAvailabilityModules } from '../support/check-room-availability.js';
import { truncateAllTables } from '../support/database.js';

/**
 * T017 de `check-room-availability`: ningún log de la verificación escribe datos personales (plan base,
 * "sin datos personales en los logs"). Todo es real salvo el Módulo 1, que se simula en HTTP (msw): los
 * módulos de Nest, el adaptador HTTP, la configuración y PostgreSQL. La habitación 201 la ocupa una
 * reserva cuyo titular tiene todos sus datos; la verificación recorre cada camino, el que termina bien y
 * los que fallan, y se revisa todo lo que se escribe en el log.
 */

/** La estadía del ejemplo del DTO del plan (dos noches). */
const START = '2026-10-10';
const END = '2026-10-12';

/** El titular de la reserva que ocupa la 201 (el del ejemplo del plan de `check-view-reservation`). */
const HOLDER = {
  firstName: 'Ana',
  lastName: 'Pérez',
  documentType: 'CC',
  documentNumber: '1144093552',
  contactPhone: '+57 300 000 0000',
  contactEmail: 'ana@correo.com',
} as const;

/** Un nombre que el Módulo 1 no debería enviar en un mantenimiento: si llega, no se escribe. */
const MAINTENANCE_REQUESTER = 'Carlos Gómez';

const PERSONAL_DATA = [
  HOLDER.firstName,
  HOLDER.lastName,
  HOLDER.documentNumber,
  HOLDER.contactPhone,
  HOLDER.contactEmail,
  MAINTENANCE_REQUESTER,
];

const server = setupServer();

describe('VerifyAvailability: los logs no escriben datos personales (T017)', () => {
  let moduleRef: TestingModule;
  let availability: VerifyAvailability;
  let dataSource: DataSource;
  let baseUrl: string;
  let logs: string[];

  const roomsUrl = () => `${baseUrl}/api/rooms`;
  const maintenancesUrl = () => `${baseUrl}/api/rooms/:roomId/maintenances`;

  /** El Módulo 1 que responde bien: las dos habitaciones, y la 202 sin mantenimientos. */
  function module1Answering(
    maintenance: (roomId: string) => Response | Promise<Response>,
  ): void {
    server.use(
      http.get(roomsUrl(), () => HttpResponse.json([ROOM_201, ROOM_202])),
      http.get(`${baseUrl}/api/rooms/:roomId`, ({ params }) =>
        HttpResponse.json(
          [ROOM_201, ROOM_202].find((room) => room.id === params.roomId),
        ),
      ),
      http.get(maintenancesUrl(), ({ params }) =>
        maintenance(String(params.roomId)),
      ),
    );
  }

  const free = (roomId: string) =>
    HttpResponse.json({ roomId, available: true, conflicts: [] });

  const check = (query: Partial<AvailabilityQuery> = {}) =>
    availability.check({
      startDate: START,
      endDate: END,
      categoryRoom: 'DOBLE',
      ...query,
    });

  /** Lo que se escribió en el log que tenga alguno de los datos personales. */
  const leaked = () =>
    logs.filter((line) => PERSONAL_DATA.some((data) => line.includes(data)));

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: await checkRoomAvailabilityModules(),
    }).compile();
    availability = moduleRef.get<VerifyAvailability>(VERIFY_AVAILABILITY);
    dataSource = moduleRef.get(DataSource);
    baseUrl = moduleRef
      .get<ConfigService<EnvironmentVariables, true>>(ConfigService)
      .get('MODULE1_BASE_URL', { infer: true });
    server.listen({ onUnhandledRequest: 'error' });
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    await new TypeOrmReservationRepository(dataSource).insert(
      aDirectReservation({
        startDate: START,
        endDate: END,
        guest: aGuest(HOLDER),
        rooms: [aDirectRoom({ roomId: ROOM_201.id })],
      }),
    );
    logs = captureLogs();
  });

  afterEach(() => {
    server.resetHandlers();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    server.close();
    await moduleRef?.close();
  });

  it('una verificación que termina bien, con la 201 reservada por Ana y la 202 libre', async () => {
    module1Answering(free);

    const result = await check();

    expect(result.rooms.map(({ reason }) => reason)).toEqual([
      'RESERVED',
      null,
    ]);
    expect(leaked()).toEqual([]);
  });

  it('un mantenimiento con un nombre en un campo que el contrato no tiene', async () => {
    module1Answering((roomId) =>
      HttpResponse.json({
        roomId,
        available: false,
        conflicts: [
          {
            maintenanceStart: START,
            maintenanceEnd: END,
            reason: `Reparación pedida por ${MAINTENANCE_REQUESTER}`,
          },
        ],
      }),
    );

    const result = await check();

    expect(result.rooms[1]).toMatchObject({ reason: 'MAINTENANCE' });
    expect(leaked()).toEqual([]);
  });

  it('el calendario responde 503: MAINTENANCE_CHECK_UNAVAILABLE, con el fallo en el log y sin datos personales', async () => {
    module1Answering(
      () =>
        new HttpResponse(`Error para ${MAINTENANCE_REQUESTER}`, {
          status: 503,
        }),
    );

    await expect(check()).rejects.toMatchObject({
      errorCode: 'MAINTENANCE_CHECK_UNAVAILABLE',
    });
    expect(logs.length).toBeGreaterThan(0);
    expect(leaked()).toEqual([]);
  });

  it('el calendario responde con otra forma y un nombre: el detalle no se copia al log', async () => {
    module1Answering(() =>
      HttpResponse.json({ requestedBy: MAINTENANCE_REQUESTER }),
    );

    await expect(check()).rejects.toMatchObject({
      errorCode: 'MAINTENANCE_CHECK_UNAVAILABLE',
    });
    expect(logs.length).toBeGreaterThan(0);
    expect(leaked()).toEqual([]);
  });

  it('el inventario no responde a tiempo: INVENTORY_UNAVAILABLE, sin datos personales', async () => {
    const timeoutMs = moduleRef
      .get<ConfigService<EnvironmentVariables, true>>(ConfigService)
      .get('MODULE1_TIMEOUT_MS', { infer: true });
    server.use(
      http.get(roomsUrl(), async () => {
        await delay(timeoutMs + 500);
        return HttpResponse.json([ROOM_201, ROOM_202]);
      }),
    );

    await expect(check()).rejects.toMatchObject({
      errorCode: 'INVENTORY_UNAVAILABLE',
    });
    expect(logs.length).toBeGreaterThan(0);
    expect(leaked()).toEqual([]);
  });

  it('por roomId, con la habitación de la reserva de Ana', async () => {
    module1Answering(free);

    const result = await check({
      categoryRoom: undefined,
      roomId: ROOM_201.id,
    });

    expect(result.rooms[0]).toMatchObject({ reason: 'RESERVED' });
    expect(leaked()).toEqual([]);
  });

  it.each<[string, Partial<AvailabilityQuery>]>([
    ['fechas inválidas', { endDate: START }],
    ['categoría y roomId a la vez', { roomId: ROOM_201.id }],
    [
      'la reserva que se modifica con otro formato',
      { excludeReservationRef: 'rsv-1' },
    ],
  ])(
    'un dato inválido (%s) no escribe datos personales',
    async (_caso, query) => {
      await expect(check(query)).rejects.toHaveProperty('errorCode');
      expect(leaked()).toEqual([]);
    },
  );
});
