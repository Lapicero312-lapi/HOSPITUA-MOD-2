import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import type {
  Transaction,
  TransactionRunner,
} from '../../../application/ports/out/transaction.js';

/** Por dentro, una `Transaction` es el `EntityManager` de TypeORM de esa transacción. */
function toTransaction(manager: EntityManager): Transaction {
  return manager as unknown as Transaction;
}

function managerOf(tx: Transaction): EntityManager {
  return tx as unknown as EntityManager;
}

/**
 * Ejecuta `work` en la transacción recibida o, si no hay ninguna, en una nueva. Así un repositorio
 * escribe en la transacción del caso de uso, o sola cuando nadie se la pasa.
 */
export function inTransaction<T>(
  dataSource: DataSource,
  tx: Transaction | undefined,
  work: (manager: EntityManager) => Promise<T>,
): Promise<T> {
  return tx ? work(managerOf(tx)) : dataSource.transaction(work);
}

/** El `EntityManager` de la transacción recibida o, si no hay ninguna, el de la conexión. */
export function managerFor(
  dataSource: DataSource,
  tx: Transaction | undefined,
): EntityManager {
  return tx ? managerOf(tx) : dataSource.manager;
}

@Injectable()
export class TypeOrmTransactionRunner implements TransactionRunner {
  constructor(private readonly dataSource: DataSource) {}

  run<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.dataSource.transaction((manager) =>
      work(toTransaction(manager)),
    );
  }
}
