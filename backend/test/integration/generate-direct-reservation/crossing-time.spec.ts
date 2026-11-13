import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  RESERVATION_LOOKUP,
  type ReservationLookup,
} from '../../../src/application/use-cases/check-view-reservation/ports/in/reservation-lookup.port.js';
import { integrationEnv, truncateAllTables } from '../support/database.js';
import { FakeDailyListPublisherModule } from '../support/fake-daily-list-publisher.js';

/**
 * Prueba de tiempo de `generate-direct-reservation` (T015), NFR-001: "El procesamiento de la verificación
 * local de reservas cruzadas debe completarse en menos de 200 milisegundos". El dato es el del plan: 50 000
 * reservas.
 *
 * La verificación local es el cruce de las habitaciones candidatas con las reservas guardadas:
 * `ReservationLookup.findBlockingRooms`, el paso que `VerifyAvailability` hace contra PostgreSQL, sin
 * los Módulos 1 y 3. Todo es real: el módulo de Nest, el repositorio y PostgreSQL, con el índice de la
 * restricción anti-solape (D3).
 *
 * Las 50 000 reservas se cargan con SQL por lotes, porque son datos de la prueba; lo que se mide es el
 * código de producción. Después se corre `ANALYZE`, como haría el autovacuum de una base en uso, para que
 * PostgreSQL elija sus planes con estadísticas reales.
 */

const LIMIT_MS = 200;

/** 100 habitaciones con 500 estadías seguidas de dos noches cada una, desde el 2026-01-01. */
const ROOMS = 100;
const STAYS_PER_ROOM = 500;
const RESERVATIONS = ROOMS * STAYS_PER_ROOM;

/** El `roomId` de la habitación número `room` (de 0 a 99), como lo arma la carga. */
const roomId = (room: number) =>
  `00000000-0000-4000-8000-${String(room).padStart(12, '0')}`;

/** Una categoría de 20 habitaciones (de la 0 a la 19) y todas las del hotel. */
const CATEGORY = Array.from({ length: 20 }, (_, room) => roomId(room));
const ALL_ROOMS = Array.from({ length: ROOMS }, (_, room) => roomId(room));

/** Las habitaciones cuyo número termina en 9 solo tienen reservas canceladas: nunca ocupan inventario. */
const neverBlocks = (room: number) => room % 10 === 9;

describe('generate-direct-reservation: el cruce local con 50 000 reservas en menos de 200 ms (T015, NFR-001)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let lookup: ReservationLookup;

  /** Cuánto tarda `work`, en milisegundos. */
  async function timed<T>(
    work: () => Promise<T>,
  ): Promise<{ result: T; elapsed: number }> {
    const start = performance.now();
    const result = await work();
    return { result, elapsed: performance.now() - start };
  }

  /**
   * Carga las reservas, sus titulares y sus habitaciones. La reserva `g` (de 0 a 49 999) es de la
   * habitación `g % 100` y su estadía es la número `g / 100` de esa habitación: dos noches, una detrás de
   * la otra, así que ninguna se cruza con otra. Las de las habitaciones terminadas en 9 están canceladas.
   */
  async function loadReservations(): Promise<void> {
    await dataSource.query(
      `INSERT INTO reservation
         (id, reservation_ref, source, start_date, end_date, guest_count, status, status_reason)
       SELECT gen_random_uuid(), 'RSV-' || upper(lpad(to_hex(g), 8, '0')), 'DIRECT',
              DATE '2026-01-01' + 2 * (g / $2::int), DATE '2026-01-03' + 2 * (g / $2::int), 2,
              CASE WHEN (g % $2::int) % 10 = 9 THEN 'CANCELLED' ELSE 'ACTIVE' END,
              CASE WHEN (g % $2::int) % 10 = 9 THEN 'CANCELLED_BY_RECEPTION' END
       FROM generate_series(0, $1::int - 1) AS g`,
      [RESERVATIONS, ROOMS],
    );
    await dataSource.query(
      `INSERT INTO guest
         (id, reservation_id, first_name, last_name, document_type, document_number, nationality)
       SELECT gen_random_uuid(), r.id, 'Nombre', 'Apellido', 'CC', substring(r.reservation_ref FROM 5),
              'Colombia'
       FROM reservation r`,
    );
    await dataSource.query(
      `INSERT INTO reservation_room
         (id, reservation_id, room_id, room_number, category_room, guest_count, room_gross_amount,
          quote_id, currency, stay_status, start_date, end_date, blocks_inventory)
       SELECT gen_random_uuid(), r.id,
              ('00000000-0000-4000-8000-' || lpad((n.g % $1::int)::text, 12, '0'))::uuid,
              (n.g % $1::int)::text, 'DOBLE', 2, 530000, 'Q-' || n.g, 'COP', 'EXPECTED',
              r.start_date, r.end_date, r.status = 'ACTIVE'
       FROM reservation r
       CROSS JOIN LATERAL (
         SELECT ('x' || substring(r.reservation_ref FROM 5))::bit(32)::int AS g
       ) n`,
      [ROOMS],
    );
    await dataSource.query('ANALYZE reservation, reservation_room, guest');
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
    const { CheckViewReservationModule } =
      await import('../../../src/application/use-cases/check-view-reservation/check-view-reservation.module.js');
    moduleRef = await Test.createTestingModule({
      imports: [
        AppConfigModule,
        PersistenceModule,
        ClockModule,
        FakeDailyListPublisherModule,
        CheckViewReservationModule,
      ],
    }).compile();
    dataSource = moduleRef.get(DataSource);
    lookup = moduleRef.get<ReservationLookup>(RESERVATION_LOOKUP);

    await truncateAllTables(dataSource);
    await loadReservations();
    // La primera consulta abre la conexión: no es la de una aplicación en uso.
    await lookup.findBlockingRooms(CATEGORY, '2026-01-01', '2026-01-03');
  }, 120_000);

  afterAll(async () => {
    // Las demás pruebas no tienen por qué cargar con 50 000 reservas.
    if (dataSource !== undefined) {
      await truncateAllTables(dataSource);
    }
    await moduleRef?.close();
  });

  it('la base tiene las 50 000 reservas, cada una con su habitación', async () => {
    const [counts]: {
      reservations: number;
      rooms: number;
      blocking: number;
    }[] = await dataSource.query(
      `SELECT (SELECT count(*)::int FROM reservation) AS reservations,
                (SELECT count(*)::int FROM reservation_room) AS rooms,
                (SELECT count(*)::int FROM reservation_room WHERE blocks_inventory) AS blocking`,
    );

    expect(counts).toEqual({
      reservations: RESERVATIONS,
      rooms: RESERVATIONS,
      // 90 de las 100 habitaciones ocupan inventario en sus 500 estadías.
      blocking: 90 * STAYS_PER_ROOM,
    });
  });

  it.each([
    ['una categoría de 20 habitaciones', CATEGORY],
    ['las 100 habitaciones del hotel', ALL_ROOMS],
  ])(
    'cruza %s con una estadía de tres noches en menos de 200 ms',
    async (_, roomIds) => {
      // En la mitad de los datos: cada habitación que ocupa inventario tiene estadías en esas noches.
      const { result, elapsed } = await timed(() =>
        lookup.findBlockingRooms(roomIds, '2027-03-10', '2027-03-13'),
      );

      expect(elapsed).toBeLessThan(LIMIT_MS);
      // Fue el cruce completo: ocupadas todas, menos las que solo tienen reservas canceladas.
      const expected = roomIds.filter((_id, room) => !neverBlocks(room));
      expect([...new Set(result.map((room) => room.roomId))].sort()).toEqual(
        [...expected].sort(),
      );
    },
  );

  it('cruza una categoría con fechas sin ninguna reserva en menos de 200 ms y no encuentra ocupadas', async () => {
    const { result, elapsed } = await timed(() =>
      lookup.findBlockingRooms(CATEGORY, '2030-01-10', '2030-01-13'),
    );

    expect(elapsed).toBeLessThan(LIMIT_MS);
    expect(result).toEqual([]);
  });

  it('el día de salida de la última estadía no cuenta como ocupado: una llegada ese día no choca, en menos de 200 ms', async () => {
    // La última estadía de cada habitación sale el 2028-09-27 (2026-01-01 más 2 × 500 días).
    const { result, elapsed } = await timed(() =>
      lookup.findBlockingRooms(CATEGORY, '2028-09-27', '2028-09-29'),
    );

    expect(elapsed).toBeLessThan(LIMIT_MS);
    expect(result).toEqual([]);
  });

  it('el día de salida de la estadía pedida tampoco cuenta: salir el día en que llega la primera reserva no choca, en menos de 200 ms', async () => {
    // La primera estadía de cada habitación llega el 2026-01-01.
    const { result, elapsed } = await timed(() =>
      lookup.findBlockingRooms(CATEGORY, '2025-12-30', '2026-01-01'),
    );

    expect(elapsed).toBeLessThan(LIMIT_MS);
    expect(result).toEqual([]);
  });
});
