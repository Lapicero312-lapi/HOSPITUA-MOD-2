import { Injectable } from '@nestjs/common';
import { DataSource, IsNull, QueryFailedError } from 'typeorm';
import type { BookingRevisionStatus } from '../../../../application/integration/booking-revision.js';
import {
  DuplicateOtaBookingRevisionError,
  type OtaBookingRevisionRepository,
  type OtaBookingRevisionResult,
  type ProcessedRevision,
} from '../../../../application/ports/out/ota-booking-revision.repository.js';
import type { Transaction } from '../../../../application/ports/out/transaction.js';
import { OtaBookingRevisionTable } from '../tables/ota-booking-revision.table.js';
import { managerFor } from '../typeorm-transaction.js';

/**
 * `OtaBookingRevisionRepository` sobre la tabla `ota_booking_revision` (la crea la migración base). Las
 * horas las pone la base (`now()`), como en `processed_message`.
 */
@Injectable()
export class TypeOrmOtaBookingRevisionRepository implements OtaBookingRevisionRepository {
  constructor(private readonly dataSource: DataSource) {}

  async findById(
    revisionId: string,
    tx?: Transaction,
  ): Promise<ProcessedRevision | null> {
    const row = await managerFor(this.dataSource, tx).findOneBy(
      OtaBookingRevisionTable,
      { revisionId },
    );
    return row ? toProcessedRevision(row) : null;
  }

  async record(
    revision: Omit<ProcessedRevision, 'processedAt' | 'ackedAt'>,
    tx: Transaction,
  ): Promise<void> {
    try {
      // processed_at toma now() de la base; acked_at queda vacío hasta el ack.
      await managerFor(this.dataSource, tx).query(
        `INSERT INTO ota_booking_revision
           (revision_id, ota_id, booking_id, status, reservation_id, result)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          revision.revisionId,
          revision.otaId,
          revision.bookingId,
          revision.status,
          revision.reservationId,
          revision.result,
        ],
      );
    } catch (error) {
      throw translateDuplicate(error, revision.revisionId);
    }
  }

  async markAcked(revisionId: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE ota_booking_revision SET acked_at = now()
       WHERE revision_id = $1 AND acked_at IS NULL`,
      [revisionId],
    );
  }

  async findBookingIdOf(
    reservationId: string,
    tx?: Transaction,
  ): Promise<string | null> {
    // Todas las revisiones de una reserva traen el mismo booking_id: basta la más reciente.
    const rows: { booking_id: string }[] = await managerFor(
      this.dataSource,
      tx,
    ).query(
      `SELECT booking_id::text AS booking_id FROM ota_booking_revision
       WHERE reservation_id = $1
       ORDER BY processed_at DESC
       LIMIT 1`,
      [reservationId],
    );
    return rows.length > 0 ? rows[0].booking_id : null;
  }

  async findPendingAck(): Promise<ProcessedRevision[]> {
    const rows = await this.dataSource.manager.find(OtaBookingRevisionTable, {
      where: { ackedAt: IsNull() },
      // Con la misma hora, el orden no cambia de una lectura a otra.
      order: { processedAt: 'ASC', revisionId: 'ASC' },
    });
    return rows.map(toProcessedRevision);
  }
}

function toProcessedRevision(row: OtaBookingRevisionTable): ProcessedRevision {
  return {
    revisionId: row.revisionId,
    otaId: row.otaId,
    bookingId: row.bookingId,
    // La base solo acepta estos valores (CHECK de la migración base).
    status: row.status as BookingRevisionStatus,
    reservationId: row.reservationId,
    result: row.result as OtaBookingRevisionResult,
    processedAt: row.processedAt,
    ackedAt: row.ackedAt,
  };
}

/** La clave primaria de `ota_booking_revision` como `DuplicateOtaBookingRevisionError`. */
function translateDuplicate(error: unknown, revisionId: string): unknown {
  if (error instanceof QueryFailedError) {
    const { code, constraint } = error.driverError as {
      code?: string;
      constraint?: string;
    };
    if (code === '23505' && constraint === 'ota_booking_revision_pkey') {
      return new DuplicateOtaBookingRevisionError(revisionId);
    }
  }
  return error;
}
