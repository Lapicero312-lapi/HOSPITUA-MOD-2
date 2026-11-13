import type { Transaction } from './transaction.js';

/** Símbolo con el que Nest inyecta el repositorio (plan base, regla 4). */
export const IDEMPOTENCY_KEY_REPOSITORY = Symbol('IDEMPOTENCY_KEY_REPOSITORY');

/** Una creación de reserva directa ya atendida (plan base, `idempotency_key`; D16). */
export type StoredIdempotencyKey = {
  requestHash: string;
  /** La reserva que se creó con esa clave. */
  reservationRef: string;
  createdAt: Date;
};

/** Otra solicitud con la misma clave, todavía vigente, se guardó primero. */
export class DuplicateIdempotencyKeyError extends Error {
  constructor() {
    super('Otra solicitud con la misma Idempotency-Key se guardó primero.');
  }
}

/**
 * Las claves de idempotencia de la creación de reservas directas (plan de `generate-direct-reservation`,
 * B y punto 15; T019).
 */
export interface IdempotencyKeyRepository {
  /** La clave guardada, con la referencia de su reserva, o `null` si no existe. */
  find(key: string): Promise<StoredIdempotencyKey | null>;

  /**
   * La guarda en la transacción de la reserva, con `createdAt` (`Clock.now()`): el vencimiento se decide
   * con el mismo reloj que la guardó. Una fila vencida (creada en `expiredBefore` o antes) con la misma
   * clave se reemplaza.
   * @throws DuplicateIdempotencyKeyError si ya hay una fila vigente con esa clave.
   */
  save(
    tx: Transaction,
    entry: {
      key: string;
      requestHash: string;
      reservationId: string;
      createdAt: Date;
    },
    expiredBefore: Date,
  ): Promise<void>;

  /** Borra las filas creadas antes de `before`. Devuelve cuántas borró. */
  deleteExpired(before: Date): Promise<number>;
}
