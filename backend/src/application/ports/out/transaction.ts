declare const transactionBrand: unique symbol;

/**
 * Una transacción abierta. Los casos de uso no saben cómo es por dentro: solo la reciben de
 * `TransactionRunner` y se la pasan a los repositorios y a los puertos que escriben en la misma
 * transacción (por ejemplo `DailyListChangeRecorder.record(tx, …)`).
 */
export type Transaction = { readonly [transactionBrand]: true };

/** Símbolo con el que Nest inyecta el `TransactionRunner`. */
export const TRANSACTION_RUNNER = Symbol('TRANSACTION_RUNNER');

export interface TransactionRunner {
  /**
   * Ejecuta `work` en una transacción: se confirma si termina bien y se revierte entera si lanza un
   * error. Las llamadas a otros módulos van antes, nunca dentro (plan base, regla 6).
   */
  run<T>(work: (tx: Transaction) => Promise<T>): Promise<T>;

  /**
   * Corre `work` cuando la transacción `tx` se confirme, nunca si se revierte (plan de
   * `check-view-reservation`, "Quién lo llama (T029)"). No se espera: `run` termina sin aguardarlo, y si
   * `work` falla, el error queda en el log.
   * @throws Error si `tx` no es una transacción abierta por `run` (un error del programa).
   */
  afterCommit(tx: Transaction, work: () => Promise<unknown>): void;
}
