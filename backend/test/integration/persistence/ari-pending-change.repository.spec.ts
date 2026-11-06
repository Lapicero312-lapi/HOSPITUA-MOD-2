import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AriChange } from '../../../src/application/ports/out/ari-pending-change.repository.js';
import { TypeOrmAriPendingChangeRepository } from '../../../src/infrastructure/out/persistence/repositories/ari-pending-change.repository.js';
import { TypeOrmTransactionRunner } from '../../../src/infrastructure/out/persistence/typeorm-transaction.js';
import { openTestDataSource, truncateAllTables } from '../support/database.js';

/** El rango del ejemplo de A4 del plan de `configure-ota`: una noche, la del 10 de noviembre. */
const DOBLE_ONE_NIGHT: AriChange = {
  categoryRoom: 'DOBLE',
  dateFrom: '2026-11-10',
  dateTo: '2026-11-11',
};
const SUITE_THREE_NIGHTS: AriChange = {
  categoryRoom: 'SUITE',
  dateFrom: '2026-11-12',
  dateTo: '2026-11-15',
};

describe('TypeOrmAriPendingChangeRepository contra PostgreSQL real', () => {
  let dataSource: DataSource;
  let changes: TypeOrmAriPendingChangeRepository;
  let transactions: TypeOrmTransactionRunner;

  const insert = (pending: AriChange[]) =>
    transactions.run((tx) => changes.insert(pending, tx));

  /** Las marcas sin su id, que lo pone la base. */
  const pendingWithoutIds = async () =>
    (await changes.findAll()).map(({ id: _id, ...change }) => change);

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    changes = new TypeOrmAriPendingChangeRepository(dataSource);
    transactions = new TypeOrmTransactionRunner(dataSource);
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  describe('insert (B2)', () => {
    it('deja una marca por cambio, con su categoría y sus fechas', async () => {
      await insert([DOBLE_ONE_NIGHT, SUITE_THREE_NIGHTS]);

      const pending = await changes.findAll();
      expect(pending).toHaveLength(2);
      expect(pending.map(({ id: _id, ...change }) => change)).toEqual(
        expect.arrayContaining([DOBLE_ONE_NIGHT, SUITE_THREE_NIGHTS]),
      );
      // El id lo pone la base, distinto para cada marca.
      expect(new Set(pending.map(({ id }) => id)).size).toBe(2);
    });

    it('dos cambios iguales dejan dos marcas: se unen al enviar (regla 4)', async () => {
      await insert([DOBLE_ONE_NIGHT, DOBLE_ONE_NIGHT]);

      expect(await pendingWithoutIds()).toEqual([
        DOBLE_ONE_NIGHT,
        DOBLE_ONE_NIGHT,
      ]);
    });

    it('sin cambios, no deja nada', async () => {
      await insert([]);

      expect(await changes.findAll()).toEqual([]);
    });

    it('si la transacción del cambio de la reserva se revierte, las marcas no quedan', async () => {
      await expect(
        transactions.run(async (tx) => {
          await changes.insert([DOBLE_ONE_NIGHT], tx);
          throw new Error('falla la reserva');
        }),
      ).rejects.toThrow('falla la reserva');

      expect(await changes.findAll()).toEqual([]);
    });

    it('la base rechaza un rango sin noches (date_to igual a date_from) y no deja ninguna marca del lote', async () => {
      await expect(
        insert([
          DOBLE_ONE_NIGHT,
          { ...SUITE_THREE_NIGHTS, dateTo: SUITE_THREE_NIGHTS.dateFrom },
        ]),
      ).rejects.toThrow();

      expect(await changes.findAll()).toEqual([]);
    });
  });

  describe('findAll (T010)', () => {
    it('devuelve las marcas de la más antigua a la más reciente', async () => {
      await insert([DOBLE_ONE_NIGHT]);
      await insert([SUITE_THREE_NIGHTS]);
      // La de SUITE se insertó después, pero queda como la más antigua: el orden es por created_at, no por
      // el orden de inserción ni por el id.
      await dataSource.query(
        `UPDATE ari_pending_change SET created_at = '2026-11-01T08:00:00-05:00'
         WHERE category_room = 'SUITE'`,
      );

      expect(await pendingWithoutIds()).toEqual([
        SUITE_THREE_NIGHTS,
        DOBLE_ONE_NIGHT,
      ]);
    });
  });

  describe('deleteByIds (T010)', () => {
    it('borra solo las marcas enviadas: la que llegó durante el envío se conserva', async () => {
      await insert([DOBLE_ONE_NIGHT, SUITE_THREE_NIGHTS]);
      const sent = (await changes.findAll()).map(({ id }) => id);
      const arrivedWhileSending: AriChange = {
        categoryRoom: 'DOBLE',
        dateFrom: '2026-11-20',
        dateTo: '2026-11-22',
      };
      await insert([arrivedWhileSending]);

      await changes.deleteByIds(sent);

      expect(await pendingWithoutIds()).toEqual([arrivedWhileSending]);
    });

    it('sin ids, no borra nada', async () => {
      await insert([DOBLE_ONE_NIGHT]);

      await changes.deleteByIds([]);

      expect(await pendingWithoutIds()).toEqual([DOBLE_ONE_NIGHT]);
    });
  });
});
