import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { openTestDataSource, truncateAllTables } from '../support/database.js';

/** Las 17 tablas de "Modelo de datos base (PostgreSQL)" del plan base. */
const MODEL_TABLES = [
  'ari_pending_change',
  'cancellation',
  'commission_audit',
  'daily_list_message',
  'daily_sequence',
  'guest',
  'guest_data',
  'idempotency_key',
  'migratory_movement',
  'ota',
  'ota_booking_revision',
  'ota_no_show_report',
  'ota_room_type_mapping',
  'processed_message',
  'reservation',
  'reservation_room',
  'sire_export',
];

describe('Esquema base (migración de T007) contra PostgreSQL real', () => {
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
    const [{ id }] = await dataSource.query(
      `INSERT INTO reservation (reservation_ref, source, start_date, end_date, guest_count, status)
       VALUES ($1, 'DIRECT', '2026-11-10', '2026-11-13', 2, 'ACTIVE') RETURNING id`,
      [ref],
    );
    return id;
  }

  async function insertRoom(
    reservationId: string,
    roomId: string,
    startDate: string,
    endDate: string,
    blocksInventory = true,
  ): Promise<void> {
    await dataSource.query(
      `INSERT INTO reservation_room
         (reservation_id, room_id, room_number, category_room, guest_count, start_date, end_date, blocks_inventory)
       VALUES ($1, $2, '201', 'DOBLE', 2, $3, $4, $5)`,
      [reservationId, roomId, startDate, endDate, blocksInventory],
    );
  }

  it('crea las 17 tablas del modelo', async () => {
    const rows: { table_name: string }[] = await dataSource.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> 'migrations'
       ORDER BY table_name`,
    );

    expect(rows.map((row) => row.table_name)).toEqual(MODEL_TABLES);
  });

  describe('restricción anti-solape (D3)', () => {
    const room = randomUUID();

    it('rechaza dos estadías que se cruzan en la misma habitación', async () => {
      await insertRoom(
        await insertReservation('RSV-0000000A'),
        room,
        '2026-11-10',
        '2026-11-13',
      );
      const other = await insertReservation('RSV-0000000B');

      await expect(
        insertRoom(other, room, '2026-11-12', '2026-11-14'),
      ).rejects.toMatchObject({
        driverError: {
          code: '23P01',
          constraint: 'ex_reservation_room_no_overlap',
        },
      });
    });

    it('una salida y una llegada el mismo día no chocan', async () => {
      await insertRoom(
        await insertReservation('RSV-0000000A'),
        room,
        '2026-11-10',
        '2026-11-13',
      );

      await expect(
        insertRoom(
          await insertReservation('RSV-0000000B'),
          room,
          '2026-11-13',
          '2026-11-15',
        ),
      ).resolves.toBeUndefined();
    });

    it('una habitación que no bloquea inventario no choca', async () => {
      await insertRoom(
        await insertReservation('RSV-0000000A'),
        room,
        '2026-11-10',
        '2026-11-13',
      );

      await expect(
        insertRoom(
          await insertReservation('RSV-0000000B'),
          room,
          '2026-11-11',
          '2026-11-12',
          false,
        ),
      ).resolves.toBeUndefined();
    });
  });

  it('los avisos al Módulo 1 no repiten (operational_date, sequence_number)', async () => {
    const insertMessage = (kind: string, reservationId: string | null) =>
      dataSource.query(
        `INSERT INTO daily_list_message
           (message_id, operational_date, sequence_number, message_kind, update_type, reservation_id, payload, publish_status)
         VALUES ($1, '2026-11-10', 1, $2, $3, $4, '{}', 'PENDING')`,
        [
          randomUUID(),
          kind,
          kind === 'UPDATE' ? 'UPDATED' : null,
          reservationId,
        ],
      );
    await insertMessage('LIST', null);

    await expect(
      insertMessage('UPDATE', await insertReservation('RSV-0000000A')),
    ).rejects.toMatchObject({
      driverError: {
        code: '23505',
        constraint: 'uq_daily_list_message_sequence',
      },
    });
  });
});
