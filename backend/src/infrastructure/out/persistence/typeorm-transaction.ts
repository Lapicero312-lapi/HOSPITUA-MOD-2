import {
  type BeforeApplicationShutdown,
  Injectable,
  Logger,
} from '@nestjs/common';
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

/**
 * Lo que espera la confirmación de cada transacción abierta por `run`. Es del módulo y no de cada instancia:
 * así una transacción se reconoce aunque quien llama a `afterCommit` tenga otra instancia del runner.
 */
const pendingAfterCommit = new WeakMap<
  EntityManager,
  (() => Promise<unknown>)[]
>();

@Injectable()
export class TypeOrmTransactionRunner
  implements TransactionRunner, BeforeApplicationShutdown
{
  private readonly logger = new Logger(TypeOrmTransactionRunner.name);

  /** Las tareas posteriores a una confirmación que siguen en curso, para esperarlas al apagar. */
  private readonly running = new Set<Promise<unknown>>();

  constructor(private readonly dataSource: DataSource) {}

  /** Espera las tareas posteriores a una confirmación antes de que se cierre la conexión a la base. */
  async beforeApplicationShutdown(): Promise<void> {
    await Promise.all([...this.running]);
  }

  async run<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    const afterCommit: (() => Promise<unknown>)[] = [];
    const result = await this.dataSource.transaction((manager) => {
      pendingAfterCommit.set(manager, afterCommit);
      return work(toTransaction(manager));
    });
    // Ya confirmada: si `work` o el COMMIT fallaban, no se llega aquí y nada de esto corre.
    for (const task of afterCommit) {
      const execution = task()
        .catch((error: unknown) => {
          this.logger.error(
            'Falló una tarea posterior a la confirmación de la transacción',
            error instanceof Error ? error.stack : String(error),
          );
        })
        .finally(() => this.running.delete(execution));
      this.running.add(execution);
    }
    return result;
  }

  afterCommit(tx: Transaction, work: () => Promise<unknown>): void {
    const tasks = pendingAfterCommit.get(managerOf(tx));
    if (tasks === undefined) {
      throw new Error(
        'afterCommit recibió una transacción que no abrió TransactionRunner.run.',
      );
    }
    tasks.push(work);
  }
}
