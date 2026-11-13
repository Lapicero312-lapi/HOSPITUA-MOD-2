import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  DuplicateIdempotencyKeyError,
  type IdempotencyKeyRepository,
  type StoredIdempotencyKey,
} from '../../../../application/ports/out/idempotency-key.repository.js';
import type { Transaction } from '../../../../application/ports/out/transaction.js';
import { managerFor } from '../typeorm-transaction.js';

/** `IdempotencyKeyRepository` sobre la tabla `idempotency_key` (la crea la migración base, D16). */
@Injectable()
export class TypeOrmIdempotencyKeyRepository implements IdempotencyKeyRepository {
  constructor(private readonly dataSource: DataSource) {}

  async find(key: string): Promise<StoredIdempotencyKey | null> {
    // La fecha sale con `to_char` en UTC, para no depender de cómo `pg` convierte `timestamptz`.
    const rows: {
      request_hash: string;
      reservation_ref: string;
      created_at: string;
    }[] = await this.dataSource.query(
      `SELECT k.request_hash, r.reservation_ref,
              to_char(k.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
       FROM idempotency_key k JOIN reservation r ON r.id = k.reservation_id
       WHERE k.key = $1`,
      [key],
    );
    const [row] = rows;
    return row === undefined
      ? null
      : {
          requestHash: row.request_hash,
          reservationRef: row.reservation_ref,
          createdAt: new Date(row.created_at),
        };
  }

  async save(
    tx: Transaction,
    entry: { key: string; requestHash: string; reservationId: string },
    expiredBefore: Date,
  ): Promise<void> {
    // Solo reemplaza una fila vencida: si la que existe sigue vigente, no se escribe ninguna.
    const rows: unknown[] = await managerFor(this.dataSource, tx).query(
      `INSERT INTO idempotency_key (key, request_hash, reservation_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE
         SET request_hash = EXCLUDED.request_hash,
             reservation_id = EXCLUDED.reservation_id,
             created_at = now()
         WHERE idempotency_key.created_at < $4
       RETURNING key`,
      [entry.key, entry.requestHash, entry.reservationId, expiredBefore],
    );
    if (rows.length === 0) {
      throw new DuplicateIdempotencyKeyError();
    }
  }

  async deleteExpired(before: Date): Promise<number> {
    const [, affected]: [unknown, number] = await this.dataSource.query(
      'DELETE FROM idempotency_key WHERE created_at < $1',
      [before],
    );
    return affected;
  }
}
