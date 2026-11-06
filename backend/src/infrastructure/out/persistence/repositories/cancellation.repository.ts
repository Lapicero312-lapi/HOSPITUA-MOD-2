import { Injectable } from '@nestjs/common';
import { DataSource, QueryFailedError } from 'typeorm';
import {
  DuplicateCancellationError,
  type CancellationRepository,
} from '../../../../application/ports/out/cancellation.repository.js';
import type { Transaction } from '../../../../application/ports/out/transaction.js';
import type { Cancellation } from '../../../../domain/cancellation/cancellation.js';
import { managerFor } from '../typeorm-transaction.js';

/**
 * `CancellationRepository` sobre la tabla `cancellation` (la crea la migración base). La `Cancellation`
 * referencia la reserva por su `reservationRef` y la tabla guarda su `id`.
 */
@Injectable()
export class TypeOrmCancellationRepository implements CancellationRepository {
  constructor(private readonly dataSource: DataSource) {}

  async insert(cancellation: Cancellation, tx: Transaction): Promise<void> {
    const row = cancellation.snapshot();
    let inserted: { id: string }[];
    try {
      inserted = await managerFor(this.dataSource, tx).query(
        `INSERT INTO cancellation
           (id, reservation_id, cancellation_date, reason, channel, processed_by, status)
         SELECT $1, r.id, $3, $4, $5, $6, $7 FROM reservation r WHERE r.reservation_ref = $2
         RETURNING id`,
        [
          row.id,
          row.reservationRef,
          row.cancellationDate,
          row.reason,
          row.channel,
          row.processedBy,
          row.status,
        ],
      );
    } catch (error) {
      throw translateDuplicate(error, row.reservationRef);
    }
    if (inserted.length === 0) {
      throw new Error(`La reserva ${row.reservationRef} no existe.`);
    }
  }
}

/** La restricción única de `cancellation.reservation_id` como `DuplicateCancellationError`. */
function translateDuplicate(error: unknown, reservationRef: string): unknown {
  if (error instanceof QueryFailedError) {
    const { code, constraint } = error.driverError as {
      code?: string;
      constraint?: string;
    };
    if (code === '23505' && constraint === 'uq_cancellation_reservation') {
      return new DuplicateCancellationError(reservationRef);
    }
  }
  return error;
}
