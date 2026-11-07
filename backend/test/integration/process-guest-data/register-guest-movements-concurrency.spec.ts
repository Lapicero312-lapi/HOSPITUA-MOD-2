import { Logger } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
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
  RESERVATION_REPOSITORY,
  type ReservationRepository,
} from '../../../src/application/ports/out/reservation.repository.js';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../src/application/ports/out/transaction.js';
import {
  type GuestPayload,
  REGISTER_GUEST_MOVEMENTS,
  type RegisterGuestMovements,
  type RegisterGuestMovementsCommand,
  type RegistrationSummary,
} from '../../../src/application/use-cases/process-guest-data/ports/in/register-guest-movements.port.js';
import type { Reservation } from '../../../src/domain/reservation/reservation.js';
import { aDirectReservation, aDirectRoom } from '../../support/builders.js';
import { captureLogs } from '../support/capture-logs.js';
import { integrationEnv, truncateAllTables } from '../support/database.js';

/**
 * T010 de `process-guest-data`: dos habitaciones de la misma reserva notifican a la vez al mismo huésped
 * (por ejemplo, en un cambio de habitación). El plan, "Reglas de registro": "Idempotencia en dos niveles:
 * el `messageId` en `processed_message` (lo hace el consumidor) y las restricciones únicas, que protegen
 * incluso si dos habitaciones de la misma reserva llegan a la vez". Aquí los dos mensajes son distintos,
 * así que solo protegen los únicos `(reservation_id, document_number)` y `(guest_data_id, movement_type)`.
 *
 * Cada notificación corre en su propia transacción, como la del consumidor. La primera registra y se
 * queda abierta; la segunda arranca y la prueba espera a que PostgreSQL la deje bloqueada en el `INSERT`
 * antes de soltar la primera. Así las dos se cruzan de verdad, y no por casualidad del tiempo.
 */

const JOHN: GuestPayload = {
  firstName: 'John',
  lastName: 'Smith',
  documentType: 'PAS',
  documentNumber: 'X99',
  birthDate: '1990-05-12',
  nationality: 'Estados Unidos',
  originPlace: 'Miami, Estados Unidos',
  destinationPlace: 'Cartagena, Colombia',
};
const PIERRE: GuestPayload = {
  firstName: 'Pierre',
  lastName: 'Dubois',
  documentType: 'PAS',
  documentNumber: 'FR123456',
  birthDate: '1985-02-03',
  nationality: 'Francia',
  originPlace: 'París, Francia',
  destinationPlace: 'Medellín, Colombia',
};

/** Los `roomId` de las habitaciones de la reserva (las del constructor de pruebas siempre tienen uno). */
function roomIdsOf(reservation: Reservation): string[] {
  return reservation.rooms.map(({ roomId }) => {
    if (roomId === null) {
      throw new Error('La habitación de prueba no tiene roomId.');
    }
    return roomId;
  });
}

/** La tabla en la que la segunda transacción queda esperando a la primera. */
type BlockingTable = 'guest_data' | 'migratory_movement';

describe('RegisterGuestMovements con dos habitaciones de la misma reserva a la vez (T010)', () => {
  let moduleRef: TestingModule;
  let registration: RegisterGuestMovements;
  let transactions: TransactionRunner;
  let dataSource: DataSource;
  let reservation: Reservation;
  let room201: string;
  let room202: string;

  function command(
    changes: Partial<RegisterGuestMovementsCommand>,
  ): RegisterGuestMovementsCommand {
    return {
      reservationId: reservation.id,
      roomId: room201,
      movementType: 'ENTRY',
      movementDate: '2026-10-09',
      guests: [JOHN],
      ...changes,
    };
  }

  /**
   * Espera a que otra conexión quede bloqueada insertando en `table` (el mismo patrón de
   * `ota-booking-revision.repository.spec.ts`).
   */
  async function waitForBlockedInsert(table: BlockingTable): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt++) {
      const [{ blocked }]: { blocked: number }[] = await dataSource.query(
        `SELECT count(*)::int AS blocked FROM pg_stat_activity
         WHERE wait_event_type = 'Lock' AND pid <> pg_backend_pid()
           AND query LIKE $1`,
        [`%INSERT INTO ${table}%`],
      );
      if (blocked > 0) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`La segunda inserción en ${table} nunca quedó bloqueada`);
  }

  /**
   * La primera notificación registra en su transacción y no la termina hasta que la segunda queda
   * bloqueada en `table`. Después la primera termina: confirma, o se revierte con `firstFails`.
   * @returns El resumen de cada una (el de la primera, si se revirtió, es el error).
   */
  async function crossed(
    first: RegisterGuestMovementsCommand,
    second: RegisterGuestMovementsCommand,
    table: BlockingTable,
    { firstFails = false } = {},
  ): Promise<{
    first: PromiseSettledResult<RegistrationSummary>;
    second: RegistrationSummary;
  }> {
    let releaseFirst!: () => void;
    const firstMayFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let markFirstRegistered!: () => void;
    const firstRegistered = new Promise<void>((resolve) => {
      markFirstRegistered = resolve;
    });

    const firstRun = transactions.run(async (tx) => {
      const summary = await registration.register(tx, first);
      markFirstRegistered();
      await firstMayFinish;
      if (firstFails) {
        throw new Error('el consumidor de la primera habitación falló');
      }
      return summary;
    });
    // Si la primera fallara antes de registrar, la prueba no se queda esperando.
    await Promise.race([firstRegistered, firstRun]);

    const secondRun = transactions.run((tx) =>
      registration.register(tx, second),
    );
    await waitForBlockedInsert(table);
    releaseFirst();

    const [firstResult, secondResult] = await Promise.allSettled([
      firstRun,
      secondRun,
    ]);
    if (secondResult.status === 'rejected') {
      throw secondResult.reason;
    }
    return { first: firstResult, second: secondResult.value };
  }

  /** Los `guest_data` como `documento apellido`, por documento. */
  const storedGuests = async (): Promise<string[]> => {
    const rows: { document_number: string; last_name: string }[] =
      await dataSource.query(
        'SELECT document_number, last_name FROM guest_data ORDER BY document_number',
      );
    return rows.map((row) => `${row.document_number} ${row.last_name}`);
  };

  /** Los movimientos como `documento tipo fecha`, por documento y tipo (`ENTRY` antes que `DEPARTURE`). */
  const storedMovements = async (): Promise<string[]> => {
    const rows: {
      document_number: string;
      movement_type: string;
      movement_date: string;
    }[] = await dataSource.query(
      `SELECT gd.document_number, mm.movement_type, mm.movement_date::text AS movement_date
       FROM migratory_movement mm
       JOIN guest_data gd ON gd.id = mm.guest_data_id
       ORDER BY gd.document_number, mm.movement_type = 'DEPARTURE'`,
    );
    return rows.map(
      (row) =>
        `${row.document_number} ${row.movement_type} ${row.movement_date}`,
    );
  };

  beforeAll(async () => {
    // AppConfigModule lee el entorno al importarse: los módulos se importan después de asignarlo.
    Object.assign(process.env, { NODE_ENV: 'test', ...integrationEnv() });
    const { AppConfigModule } =
      await import('../../../src/infrastructure/config/app-config.module.js');
    const { PersistenceModule } =
      await import('../../../src/infrastructure/out/persistence/persistence.module.js');
    const { ClockModule } =
      await import('../../../src/infrastructure/out/clock/clock.module.js');
    const { ProcessGuestDataModule } =
      await import('../../../src/application/use-cases/process-guest-data/process-guest-data.module.js');
    const INJECTED_REGISTRATION = Symbol('INJECTED_REGISTRATION');
    moduleRef = await Test.createTestingModule({
      imports: [
        AppConfigModule,
        PersistenceModule,
        ClockModule,
        ProcessGuestDataModule,
      ],
      providers: [
        {
          provide: INJECTED_REGISTRATION,
          inject: [REGISTER_GUEST_MOVEMENTS],
          useFactory: (injected: RegisterGuestMovements) => injected,
        },
      ],
    }).compile();
    registration = moduleRef.get<RegisterGuestMovements>(INJECTED_REGISTRATION);
    transactions = moduleRef.get<TransactionRunner>(TRANSACTION_RUNNER);
    dataSource = moduleRef.get(DataSource);
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    reservation = await moduleRef
      .get<ReservationRepository>(RESERVATION_REPOSITORY)
      .insert(
        aDirectReservation({
          rooms: [
            aDirectRoom({ roomNumber: '201' }),
            aDirectRoom({ roomNumber: '202' }),
          ],
        }),
      );
    [room201, room202] = roomIdsOf(reservation);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('dos Check-In a la vez con el mismo huésped dejan un solo GuestData y un solo ENTRY, el de la primera', async () => {
    const { first, second } = await crossed(
      command({ roomId: room201, guests: [JOHN] }),
      command({
        roomId: room202,
        movementDate: '2026-10-10',
        guests: [{ ...JOHN, lastName: 'Smith Jones' }, PIERRE],
      }),
      'guest_data',
    );

    expect(first).toEqual({
      status: 'fulfilled',
      value: {
        received: 1,
        registered: 1,
        alreadyRegistered: 0,
        foreign: 1,
        skipped: 0,
      },
    });
    // La segunda espera a la primera y encuentra a John ya registrado; a Pierre sí lo registra.
    expect(second).toEqual({
      received: 2,
      registered: 1,
      alreadyRegistered: 1,
      foreign: 2,
      skipped: 0,
    });
    await expect(storedGuests()).resolves.toEqual([
      'FR123456 Dubois',
      'X99 Smith',
    ]);
    await expect(storedMovements()).resolves.toEqual([
      'FR123456 ENTRY 2026-10-10',
      'X99 ENTRY 2026-10-09',
    ]);
  });

  it('dos Check-Out a la vez con el mismo huésped dejan un solo DEPARTURE, el de la primera, sin aviso de salida sin entrada', async () => {
    await transactions.run((tx) =>
      registration.register(tx, command({ guests: [JOHN] })),
    );
    const logs = captureLogs();

    const { first, second } = await crossed(
      command({
        roomId: room201,
        movementType: 'DEPARTURE',
        movementDate: '2026-10-12',
      }),
      command({
        roomId: room202,
        movementType: 'DEPARTURE',
        movementDate: '2026-10-13',
      }),
      'migratory_movement',
    );

    expect(first).toMatchObject({
      status: 'fulfilled',
      value: { registered: 1, alreadyRegistered: 0 },
    });
    expect(second).toMatchObject({ registered: 0, alreadyRegistered: 1 });
    await expect(storedGuests()).resolves.toEqual(['X99 Smith']);
    await expect(storedMovements()).resolves.toEqual([
      'X99 ENTRY 2026-10-09',
      'X99 DEPARTURE 2026-10-12',
    ]);
    expect(logs).toEqual([]);
  });

  it.each(['ENTRY', 'DEPARTURE'] as const)(
    'dos %s a la vez con los mismos 10 huéspedes en orden inverso terminan los dos, sin duplicados (10 vueltas)',
    { timeout: 60_000 },
    async (movementType) => {
      // Diez huéspedes extranjeros; la segunda habitación los trae al revés. Sin el orden fijo de los
      // INSERT, las dos transacciones se esperaban en cruz y PostgreSQL cancelaba una (40P01).
      const guests: GuestPayload[] = Array.from({ length: 10 }, (_, index) => ({
        ...JOHN,
        firstName: `Huésped ${index}`,
        documentNumber: `P${String(index).padStart(2, '0')}`,
      }));
      const repository = moduleRef.get<ReservationRepository>(
        RESERVATION_REPOSITORY,
      );
      vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      for (let round = 0; round < 10; round++) {
        const stay = await repository.insert(
          aDirectReservation({
            rooms: [
              aDirectRoom({ roomNumber: '201' }),
              aDirectRoom({ roomNumber: '202' }),
            ],
          }),
        );
        const [first, second] = roomIdsOf(stay);
        const notification = (roomId: string, list: GuestPayload[]) =>
          transactions.run((tx) =>
            registration.register(tx, {
              reservationId: stay.id,
              roomId,
              movementType,
              movementDate: '2026-10-12',
              guests: list,
            }),
          );
        if (movementType === 'DEPARTURE') {
          await transactions.run((tx) =>
            registration.register(tx, {
              reservationId: stay.id,
              roomId: first,
              movementType: 'ENTRY',
              movementDate: '2026-10-09',
              guests,
            }),
          );
        }

        const results = await Promise.allSettled([
          notification(first, guests),
          notification(second, [...guests].reverse()),
        ]);

        expect(results.map(({ status }) => status)).toEqual([
          'fulfilled',
          'fulfilled',
        ]);
        const summaries = results.map((result) =>
          result.status === 'fulfilled' ? result.value : null,
        );
        // Entre las dos, cada huésped se registra una sola vez.
        expect(
          summaries.reduce(
            (sum, summary) => sum + (summary?.registered ?? 0),
            0,
          ),
        ).toBe(10);
      }

      const [{ guestRows, movementRows }]: {
        guestRows: number;
        movementRows: number;
      }[] = await dataSource.query(
        `SELECT (SELECT count(*)::int FROM guest_data) AS "guestRows",
                (SELECT count(*)::int FROM migratory_movement WHERE movement_type = $1) AS "movementRows"`,
        [movementType],
      );
      expect({ guestRows, movementRows }).toEqual({
        guestRows: 100,
        movementRows: 100,
      });
    },
  );

  it('si la primera se revierte mientras la segunda espera, la segunda registra al huésped: no se pierde ni se duplica', async () => {
    const { first, second } = await crossed(
      command({ roomId: room201, guests: [JOHN] }),
      command({
        roomId: room202,
        movementDate: '2026-10-10',
        guests: [{ ...JOHN, lastName: 'Smith Jones' }],
      }),
      'guest_data',
      { firstFails: true },
    );

    expect(first).toMatchObject({ status: 'rejected' });
    expect(second).toEqual({
      received: 1,
      registered: 1,
      alreadyRegistered: 0,
      foreign: 1,
      skipped: 0,
    });
    // Quedan los datos y la fecha de la segunda, la única que se confirmó.
    await expect(storedGuests()).resolves.toEqual(['X99 Smith Jones']);
    await expect(storedMovements()).resolves.toEqual(['X99 ENTRY 2026-10-10']);
  });
});
