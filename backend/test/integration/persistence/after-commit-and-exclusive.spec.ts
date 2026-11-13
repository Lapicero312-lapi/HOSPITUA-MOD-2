import { Logger } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { Transaction } from '../../../src/application/ports/out/transaction.js';
import { AdvisoryExclusiveRunner } from '../../../src/infrastructure/out/persistence/advisory-exclusive-runner.js';
import { TypeOrmTransactionRunner } from '../../../src/infrastructure/out/persistence/typeorm-transaction.js';
import { openTestDataSource } from '../support/database.js';

/** Espera a que corran las tareas que `run` dejó sin esperar. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

/** El día de las filas de esta prueba en `daily_sequence`. */
const DAY = '2040-01-01';

describe('TransactionRunner.afterCommit y ExclusiveRunner contra PostgreSQL real (T029 de check-view-reservation)', () => {
  let dataSource: DataSource;
  let transactions: TypeOrmTransactionRunner;
  let exclusive: AdvisoryExclusiveRunner;

  const rowsOfDay = async (): Promise<number> => {
    const [{ count }]: { count: number }[] = await dataSource.query(
      'SELECT count(*)::int AS count FROM daily_sequence WHERE operational_date = $1',
      [DAY],
    );
    return count;
  };

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    transactions = new TypeOrmTransactionRunner(dataSource);
    exclusive = new AdvisoryExclusiveRunner(dataSource);
    await dataSource.query(
      'DELETE FROM daily_sequence WHERE operational_date = $1',
      [DAY],
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await dataSource.query(
      'DELETE FROM daily_sequence WHERE operational_date = $1',
      [DAY],
    );
    await dataSource.destroy();
  });

  describe('afterCommit', () => {
    it('corre después del COMMIT, no antes: la tarea ya ve lo que escribió la transacción', async () => {
      const seen: number[] = [];

      await transactions.run(async (tx) => {
        transactions.afterCommit(tx, async () => {
          seen.push(await rowsOfDay());
        });
        await (tx as unknown as EntityManager).query(
          'INSERT INTO daily_sequence (operational_date) VALUES ($1)',
          [DAY],
        );
        // Desde otra conexión todavía no se ve: no se ha confirmado.
        expect(await rowsOfDay()).toBe(0);
        expect(seen).toEqual([]);
      });
      await settle();

      expect(seen).toEqual([1]);
    });

    it('si la transacción se revierte, no corre', async () => {
      const work = vi.fn(() => Promise.resolve());

      await expect(
        transactions.run((tx) => {
          transactions.afterCommit(tx, work);
          return Promise.reject(new Error('se revierte'));
        }),
      ).rejects.toThrow('se revierte');
      await settle();

      expect(work).not.toHaveBeenCalled();
    });

    it('run no espera la tarea, y si falla, el error queda en el log sin llegar a quien llamó', async () => {
      const error = vi
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => {});
      let finished = false;

      const result = await transactions.run((tx) => {
        transactions.afterCommit(tx, async () => {
          await settle();
          finished = true;
          throw new Error('la publicación falló');
        });
        return Promise.resolve('listo');
      });

      expect(result).toBe('listo');
      expect(finished).toBe(false);
      await settle();
      await settle();
      expect(finished).toBe(true);
      expect(error).toHaveBeenCalledTimes(1);
    });

    it('al apagar, espera las tareas que siguen en curso', async () => {
      let finish: () => void = () => {};
      await transactions.run((tx) => {
        transactions.afterCommit(
          tx,
          () =>
            new Promise<void>((resolve) => {
              finish = resolve;
            }),
        );
        return Promise.resolve();
      });
      let shutDown = false;

      const shutdown = transactions.beforeApplicationShutdown().then(() => {
        shutDown = true;
      });
      await settle();
      expect(shutDown).toBe(false);
      finish();
      await shutdown;

      expect(shutDown).toBe(true);
    });

    it('una transacción de otra instancia del runner también se reconoce', async () => {
      const other = new TypeOrmTransactionRunner(dataSource);
      const work = vi.fn(() => Promise.resolve());

      await other.run((tx) => {
        transactions.afterCommit(tx, work);
        return Promise.resolve();
      });
      await settle();

      expect(work).toHaveBeenCalledTimes(1);
    });

    it('con una transacción que no abrió run, es un error del programa', () => {
      expect(() =>
        transactions.afterCommit({} as Transaction, () => Promise.resolve()),
      ).toThrow('afterCommit');
    });
  });

  describe('ExclusiveRunner (pg_try_advisory_lock)', () => {
    it('mientras una ejecución tiene el bloqueo, otra con el mismo nombre no corre y recibe false', async () => {
      let release: () => void = () => {};
      const holding = exclusive.runExclusive(
        'prueba-t029',
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      );
      await settle();
      const second = vi.fn(() => Promise.resolve());

      expect(await exclusive.runExclusive('prueba-t029', second)).toBe(false);
      expect(second).not.toHaveBeenCalled();
      release();
      expect(await holding).toBe(true);
    });

    it('con otro nombre no se bloquean', async () => {
      let release: () => void = () => {};
      const holding = exclusive.runExclusive(
        'prueba-t029-a',
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      );
      await settle();

      expect(
        await exclusive.runExclusive('prueba-t029-b', () => Promise.resolve()),
      ).toBe(true);
      release();
      await holding;
    });

    /**
     * Si el bloqueo quedó libre, visto desde otra sesión. La conexión se toma **antes** de `runExclusive`,
     * para que el runner no la reutilice: en la misma sesión el bloqueo asesor es reentrante y daría `true`
     * aunque nunca se hubiera soltado.
     */
    async function freeFromAnotherSession(
      name: string,
      run: () => Promise<unknown>,
    ): Promise<boolean> {
      const other = dataSource.createQueryRunner();
      await other.connect();
      try {
        await run();
        const [{ locked }]: { locked: boolean }[] = await other.query(
          'SELECT pg_try_advisory_lock(hashtext($1)) AS locked',
          [name],
        );
        if (locked) {
          await other.query('SELECT pg_advisory_unlock(hashtext($1))', [name]);
        }
        return locked;
      } finally {
        await other.release();
      }
    }

    it('al terminar bien, el bloqueo queda libre para otra sesión', async () => {
      expect(
        await freeFromAnotherSession('prueba-t029-d', () =>
          exclusive.runExclusive('prueba-t029-d', () => Promise.resolve()),
        ),
      ).toBe(true);
    });

    it('suelta el bloqueo aunque el trabajo falle: queda libre para otra sesión', async () => {
      expect(
        await freeFromAnotherSession('prueba-t029-c', () =>
          expect(
            exclusive.runExclusive('prueba-t029-c', () =>
              Promise.reject(new Error('falló')),
            ),
          ).rejects.toThrow('falló'),
        ),
      ).toBe(true);
    });

    it('mientras lo tiene, otra sesión no lo consigue: la comprobación sí distingue un bloqueo tomado', async () => {
      let release: () => void = () => {};
      const holding = exclusive.runExclusive(
        'prueba-t029-e',
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      );

      const freeWhileHolding = await freeFromAnotherSession(
        'prueba-t029-e',
        settle,
      );
      release();
      await holding;

      expect(freeWhileHolding).toBe(false);
    });
  });
});
