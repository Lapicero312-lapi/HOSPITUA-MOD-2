import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  RESERVATION_REPOSITORY,
  type ReservationRepository,
} from '../../../src/application/ports/out/reservation.repository.js';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../src/application/ports/out/transaction.js';
import { readGuestStayFilters } from '../../../src/application/use-cases/process-guest-data/guest-stay-filters.validator.js';
import {
  LIST_GUEST_STAYS,
  type ListGuestStays,
} from '../../../src/application/use-cases/process-guest-data/ports/in/list-guest-stays.port.js';
import {
  type GuestPayload,
  REGISTER_GUEST_MOVEMENTS,
  type RegisterGuestMovements,
} from '../../../src/application/use-cases/process-guest-data/ports/in/register-guest-movements.port.js';
import type { Reservation } from '../../../src/domain/reservation/reservation.js';
import { aDirectReservation } from '../../support/builders.js';
import { integrationEnv, truncateAllTables } from '../support/database.js';

/**
 * Pruebas de tiempo de `process-guest-data` (T021), con los datos del plan ("Pruebas por escenario"):
 * - NFR-001: "El registro de los datos no debe superar los 500 milisegundos por notificación, con hasta
 *   10 huéspedes por notificación".
 * - NFR-003: "Una página de la vista de huéspedes alojados, con cualquier combinación de filtros, debe
 *   responder en menos de 1 segundo con hasta 50 000 movimientos registrados".
 *
 * Todo es real: `ProcessGuestDataModule`, los repositorios, la consulta de la vista y PostgreSQL. Los
 * 50 000 movimientos se cargan con SQL por lotes, porque son datos de la prueba; lo que se mide es el
 * código de producción. Después de cargarlos se corre `ANALYZE`, como haría el autovacuum de una base en
 * uso, para que PostgreSQL elija sus planes con estadísticas reales.
 */

const REGISTER_LIMIT_MS = 500;
const PAGE_LIMIT_MS = 1000;

/** 30 000 huéspedes en 100 reservas: 20 000 ya salieron (entrada y salida) y 10 000 siguen en el hotel. */
const RESERVATIONS = 100;
const GUESTS_WITH_EXIT = 20_000;
const GUESTS_IN_HOTEL = 10_000;
const MOVEMENTS = GUESTS_WITH_EXIT * 2 + GUESTS_IN_HOTEL;

/** Diez huéspedes en una habitación: cinco extranjeros y cinco colombianos. */
const TEN_GUESTS: GuestPayload[] = Array.from({ length: 10 }, (_, index) => ({
  firstName: `Huésped ${index}`,
  lastName: 'Tiempo',
  documentType: index % 2 === 0 ? 'PAS' : 'CC',
  documentNumber: `T${String(index).padStart(3, '0')}`,
  birthDate: '1990-05-12',
  nationality: index % 2 === 0 ? 'Estados Unidos' : 'Colombia',
  ...(index % 2 === 0
    ? {
        originPlace: 'Miami, Estados Unidos',
        destinationPlace: 'Cartagena, Colombia',
      }
    : {}),
}));

describe('process-guest-data: tiempo de respuesta con 50 000 movimientos (T021)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let transactions: TransactionRunner;
  let registration: RegisterGuestMovements;
  let listing: ListGuestStays;
  let reservations: ReservationRepository;

  /** Cuánto tarda `work`, en milisegundos. */
  async function timed<T>(
    work: () => Promise<T>,
  ): Promise<{ result: T; elapsed: number }> {
    const start = performance.now();
    const result = await work();
    return { result, elapsed: performance.now() - start };
  }

  /** Una notificación de la 201 de la reserva, en su propia transacción, como la del consumidor. */
  function notify(
    reservation: Reservation,
    movementType: 'ENTRY' | 'DEPARTURE',
    movementDate: string,
    guests: GuestPayload[],
  ) {
    const roomId = reservation.rooms[0].roomId;
    if (roomId === null) {
      throw new Error('La habitación de prueba no tiene roomId.');
    }
    return transactions.run((tx) =>
      registration.register(tx, {
        reservationId: reservation.id,
        roomId,
        movementType,
        movementDate,
        guests,
      }),
    );
  }

  /**
   * Carga los huéspedes y sus movimientos repartidos en el año 2026, en las reservas que ya existen:
   * uno de cada tres colombiano, algunos nombres con tilde, y la salida tres días después de la entrada.
   */
  async function loadMovements(): Promise<void> {
    await dataSource.query(
      `INSERT INTO guest_data
         (id, reservation_id, document_type, document_number, first_name, last_name, birth_date,
          nationality, origin_place, destination_place)
       SELECT gen_random_uuid(), r.id,
              CASE WHEN g % 3 = 0 THEN 'CC' ELSE 'PAS' END,
              'D' || g,
              CASE WHEN g % 7 = 0 THEN 'José' ELSE 'Nombre' END || ' ' || g,
              CASE WHEN g % 5 = 0 THEN 'Muñoz' ELSE 'Apellido' END,
              DATE '1980-01-01' + (g % 9000),
              CASE WHEN g % 3 = 0 THEN 'Colombia' ELSE 'Francia' END,
              CASE WHEN g % 3 = 0 THEN NULL ELSE 'París, Francia' END,
              CASE WHEN g % 3 = 0 THEN NULL ELSE 'Bogotá, Colombia' END
       FROM generate_series(1, $1::int) AS g
       JOIN (SELECT id, row_number() OVER (ORDER BY reservation_ref) - 1 AS n FROM reservation) r
         ON r.n = g % $2::int`,
      [GUESTS_WITH_EXIT + GUESTS_IN_HOTEL, RESERVATIONS],
    );
    // Las entradas de todos; las salidas, de los primeros 20 000.
    await dataSource.query(
      `INSERT INTO migratory_movement (id, guest_data_id, movement_type, movement_date)
       SELECT gen_random_uuid(), gd.id, 'ENTRY', DATE '2026-01-01' + (gd.n % 360)
       FROM (SELECT id, substring(document_number FROM 2)::int AS n FROM guest_data) gd`,
    );
    await dataSource.query(
      `INSERT INTO migratory_movement (id, guest_data_id, movement_type, movement_date)
       SELECT gen_random_uuid(), gd.id, 'DEPARTURE', DATE '2026-01-04' + (gd.n % 360)
       FROM (SELECT id, substring(document_number FROM 2)::int AS n FROM guest_data) gd
       WHERE gd.n <= $1::int`,
      [GUESTS_WITH_EXIT],
    );
    await dataSource.query(
      'ANALYZE guest_data, migratory_movement, reservation',
    );
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
    const { ProcessGuestDataModule } =
      await import('../../../src/application/use-cases/process-guest-data/process-guest-data.module.js');
    moduleRef = await Test.createTestingModule({
      imports: [
        AppConfigModule,
        PersistenceModule,
        ClockModule,
        ProcessGuestDataModule,
      ],
    }).compile();
    dataSource = moduleRef.get(DataSource);
    transactions = moduleRef.get<TransactionRunner>(TRANSACTION_RUNNER);
    registration = moduleRef.get<RegisterGuestMovements>(
      REGISTER_GUEST_MOVEMENTS,
    );
    listing = moduleRef.get<ListGuestStays>(LIST_GUEST_STAYS);
    reservations = moduleRef.get<ReservationRepository>(RESERVATION_REPOSITORY);

    await truncateAllTables(dataSource);
    for (let index = 0; index < RESERVATIONS; index++) {
      await reservations.insert(aDirectReservation());
    }
    await loadMovements();
  });

  afterAll(async () => {
    // Las demás pruebas no tienen por qué cargar con 50 000 movimientos.
    if (dataSource !== undefined) {
      await truncateAllTables(dataSource);
    }
    await moduleRef?.close();
  });

  it(`la carga deja ${MOVEMENTS} movimientos`, async () => {
    const [{ total }]: { total: number }[] = await dataSource.query(
      'SELECT count(*)::int AS total FROM migratory_movement',
    );

    expect(total).toBe(MOVEMENTS);
  });

  describe('NFR-001: registrar una notificación de 10 huéspedes en menos de 500 ms', () => {
    let reservation: Reservation;

    beforeAll(async () => {
      // Una notificación antes de medir, en otra reserva: la primera conexión no es la de una base en uso.
      await notify(
        await reservations.insert(aDirectReservation()),
        'ENTRY',
        '2026-10-08',
        TEN_GUESTS.map((guest) => ({
          ...guest,
          documentNumber: `W${guest.documentNumber}`,
        })),
      );
      reservation = await reservations.insert(aDirectReservation());
    });

    it('el Check-In de los 10', async () => {
      const { result, elapsed } = await timed(() =>
        notify(reservation, 'ENTRY', '2026-10-09', TEN_GUESTS),
      );

      expect(elapsed).toBeLessThan(REGISTER_LIMIT_MS);
      // Es el registro completo: diez GuestData nuevos con su ENTRY.
      expect(result).toEqual({
        received: 10,
        registered: 10,
        alreadyRegistered: 0,
        foreign: 5,
        skipped: 0,
      });
    });

    it('el Check-Out de los mismos 10', async () => {
      const { result, elapsed } = await timed(() =>
        notify(reservation, 'DEPARTURE', '2026-10-12', TEN_GUESTS),
      );

      expect(elapsed).toBeLessThan(REGISTER_LIMIT_MS);
      expect(result).toMatchObject({ registered: 10, alreadyRegistered: 0 });
    });
  });

  describe('NFR-003: una página de la vista en menos de 1 s, con cualquier combinación de filtros', () => {
    beforeAll(async () => {
      // Una consulta antes de medir, por la misma razón.
      await listing.execute(readGuestStayFilters({}));
    });

    it.each([
      ['sin filtros, la primera página', {}],
      ['sin filtros, la última página (la más lejana)', { page: '99999' }],
      [
        'extranjeros en el hotel',
        { nationality: 'FOREIGN', presence: 'IN_HOTEL' },
      ],
      [
        'colombianos que ya salieron en un periodo',
        {
          nationality: 'COLOMBIAN',
          presence: 'CHECKED_OUT',
          dateFrom: '2026-03-01',
          dateTo: '2026-05-31',
        },
      ],
      [
        'el periodo de un año completo',
        { dateFrom: '2026-01-01', dateTo: '2026-12-31' },
      ],
      ['un documento exacto', { search: 'D12345' }],
      ['un nombre parcial sin tilde ni mayúsculas', { search: 'jose' }],
      ['un apellido parcial con tilde', { search: 'Muñ' }],
      [
        'todos los filtros a la vez',
        {
          nationality: 'FOREIGN',
          presence: 'CHECKED_OUT',
          dateFrom: '2026-02-01',
          dateTo: '2026-09-30',
          search: 'nombre',
          page: '3',
        },
      ],
    ])('%s', async (_case, query: Record<string, string>) => {
      const filters = readGuestStayFilters(query);

      const { result, elapsed } = await timed(() => listing.execute(filters));

      expect(elapsed).toBeLessThan(PAGE_LIMIT_MS);
      // La consulta trabaja de verdad: encuentra filas y entrega una página.
      expect(result.totalItems).toBeGreaterThan(0);
      expect(result.items.length).toBeGreaterThan(0);
      expect(result.items.length).toBeLessThanOrEqual(10);
    });
  });
});
