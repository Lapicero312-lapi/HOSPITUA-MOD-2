import { Injectable } from '@nestjs/common';
import { DataSource, QueryFailedError } from 'typeorm';
import {
  DuplicateCancellationError,
  type CancellationRepository,
} from '../../../../application/ports/out/cancellation.repository.js';
import type { Transaction } from '../../../../application/ports/out/transaction.js';
import { Cancellation } from '../../../../domain/cancellation/cancellation.js';
import type { CancellationChannel } from '../../../../domain/shared/enums.js';
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

  async findByReservationId(
    reservationId: string,
  ): Promise<Cancellation | null> {
    const rows: CancellationRow[] = await this.dataSource.query(
      `SELECT c.id, r.reservation_ref,
              to_char(c.cancellation_date AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
                AS cancellation_date,
              c.reason, c.channel, c.processed_by, c.status
       FROM cancellation c
       JOIN reservation r ON r.id = c.reservation_id
       WHERE c.reservation_id = $1`,
      [reservationId],
    );
    const [row] = rows;
    if (row === undefined) {
      return null;
    }
    return Cancellation.restore({
      id: row.id,
      reservationRef: row.reservation_ref,
      cancellationDate: new Date(row.cancellation_date),
      reason: row.reason,
      channel: row.channel,
      processedBy: row.processed_by,
      status: row.status,
    });
  }
}

/**
 * Una fila de `cancellation` con la `reservation_ref` de su reserva. `pg` entrega `timestamptz` como texto
 * en la zona de la sesión, así que la consulta pide la fecha en ISO 8601 y en UTC, con milisegundos: los de
 * `Date`, con que se guardó.
 */
type CancellationRow = {
  id: string;
  reservation_ref: string;
  cancellation_date: string;
  reason: string | null;
  channel: CancellationChannel;
  processed_by: string;
  status: 'COMPLETED';
};

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
