declare const transactionBrand: unique symbol;

/** Una transacción abierta, opaca para la capa de aplicación. */
export type Transaction = { readonly [transactionBrand]: true };

export const TRANSACTION_RUNNER = Symbol('TRANSACTION_RUNNER');

export interface TransactionRunner {
  run<T>(work: (tx: Transaction) => Promise<T>): Promise<T>;
}
