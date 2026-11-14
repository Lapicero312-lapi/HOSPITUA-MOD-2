import type { DataSource, QueryRunner } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { openTestDataSource, truncateAllTables } from '../support/database.js';

/** Los datos de ejemplo de los planes: un `roomId` y unas fechas válidas. */
const ROOM_ID = '994d1375-dbbd-4072-8724-b2ab32ce781b';
const START_DATE = '2026-10-10';
const END_DATE = '2026-10-12';

/** Cuánto se espera a que la segunda inserción quede bloqueada antes de dar la prueba por fallida. */
const BLOCKED_TIMEOUT_MS = 5000;

describe('Restricción anti-solape (D3) contra PostgreSQL real', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = await openTestDataSource();
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  /** Una reserva directa mínima; devuelve su id. */
  async function insertReservation(ref: string): Promise<string> {
    const [{ id }]: { id: string }[] = await dataSource.query(
      `INSERT INTO reservation (reservation_ref, source, start_date, end_date, guest_count, status)
       VALUES ($1, 'DIRECT', $2, $3, 2, 'ACTIVE') RETURNING id`,
      [ref, START_DATE, END_DATE],
    );
    return id;
  }

  function insertRoom(
    queryRunner: QueryRunner,
    reservationId: string,
  ): Promise<unknown> {
    return queryRunner.query(
      `INSERT INTO reservation_room
         (reservation_id, room_id, room_number, category_room, guest_count, start_date, end_date, blocks_inventory)
       VALUES ($1, $2, '201', 'DOBLE', 2, $3, $4, true)`,
      [reservationId, ROOM_ID, START_DATE, END_DATE],
    );
  }

  async function backendPid(queryRunner: QueryRunner): Promise<number> {
    const [{ pid }]: { pid: number }[] = await queryRunner.query(
      'SELECT pg_backend_pid() AS pid',
    );
    return pid;
  }

  /** Espera a que la conexión `waiting` quede bloqueada justamente por `holder`. */
  async function waitUntilBlockedBy(
    waiting: number,
    holder: number,
  ): Promise<void> {
    const deadline = Date.now() + BLOCKED_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const [{ blocked }]: { blocked: boolean }[] = await dataSource.query(
        'SELECT $1::int = ANY (pg_blocking_pids($2::int)) AS blocked',
        [holder, waiting],
      );
      if (blocked) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('La segunda inserción no quedó esperando a la primera.');
  }

  // Las dos transacciones están abiertas a la vez y la prueba comprueba que la segunda espera a la primera.
  // Lanzarlas sin este control dependería del azar: si chocan en el mismo instante, PostgreSQL puede
  // abortar una por interbloqueo (`40P01`) en vez de por la violación de exclusión.
  it('de dos inserciones simultáneas de la misma habitación, una falla con la violación de exclusión (23P01)', async () => {
    const firstReservation = await insertReservation('RSV-3F9A1C7B');
    const secondReservation = await insertReservation('RSV-3F9A1C7C');
    const first = dataSource.createQueryRunner();
    const second = dataSource.createQueryRunner();

    try {
      await first.connect();
      await second.connect();
      const firstPid = await backendPid(first);
      const secondPid = await backendPid(second);

      await first.startTransaction();
      await insertRoom(first, firstReservation);

      await second.startTransaction();
      const secondResult = insertRoom(second, secondReservation).then(
        () => 'guardada',
        (error: unknown) => error,
      );
      await waitUntilBlockedBy(secondPid, firstPid);

      await first.commitTransaction();

      await expect(secondResult).resolves.toMatchObject({
        driverError: {
          code: '23P01',
          constraint: 'ex_reservation_room_no_overlap',
        },
      });
      await second.rollbackTransaction();
    } finally {
      if (first.isTransactionActive) {
        await first.rollbackTransaction();
      }
      if (second.isTransactionActive) {
        await second.rollbackTransaction();
      }
      await first.release();
      await second.release();
    }

    const rows: { reservation_id: string }[] = await dataSource.query(
      'SELECT reservation_id FROM reservation_room WHERE room_id = $1',
      [ROOM_ID],
    );
    expect(rows).toEqual([{ reservation_id: firstReservation }]);
  });
});
