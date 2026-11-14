import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type {
  OtaNoShowReportRepository,
  PendingNoShow,
} from '../../../../application/ports/out/ota-no-show-report.repository.js';
import type { Transaction } from '../../../../application/ports/out/transaction.js';
import { managerFor } from '../typeorm-transaction.js';

/**
 * `OtaNoShowReportRepository` sobre la tabla `ota_no_show_report` (la crea la migración base). `created_at`
 * la pone la base (`now()`); `reported_at`, quien llama, con la hora del `Clock`.
 */
@Injectable()
export class TypeOrmOtaNoShowReportRepository implements OtaNoShowReportRepository {
  constructor(private readonly dataSource: DataSource) {}

  async insertPending(
    tx: Transaction,
    reservationId: string,
    bookingId: string,
  ): Promise<void> {
    await managerFor(this.dataSource, tx).query(
      `INSERT INTO ota_no_show_report (reservation_id, booking_id)
       VALUES ($1, $2)
       ON CONFLICT (reservation_id) DO NOTHING`,
      [reservationId, bookingId],
    );
  }

  async findPending(): Promise<PendingNoShow[]> {
    const rows: {
      reservation_id: string;
      booking_id: string;
      attempts: number;
      // La consulta directa entrega `timestamptz` como texto.
      created_at: string;
    }[] = await this.dataSource.query(
      `SELECT reservation_id::text, booking_id::text, attempts, created_at
       FROM ota_no_show_report
       WHERE result = 'PENDING'
       ORDER BY created_at, reservation_id`,
    );
    return rows.map((row) => ({
      reservationId: row.reservation_id,
      bookingId: row.booking_id,
      attempts: row.attempts,
      createdAt: new Date(row.created_at),
    }));
  }

  async markReported(reservationId: string, at: Date): Promise<void> {
    await this.finish(reservationId, 'REPORTED', at);
  }

  async markRejected(reservationId: string): Promise<void> {
    await this.finish(reservationId, 'REJECTED', null);
  }

  async countAttempt(reservationId: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE ota_no_show_report SET attempts = attempts + 1
       WHERE reservation_id = $1 AND result = 'PENDING'`,
      [reservationId],
    );
  }

  /** El envío terminó: el resultado, un intento más y, si se reportó, cuándo. */
  private async finish(
    reservationId: string,
    result: 'REPORTED' | 'REJECTED',
    reportedAt: Date | null,
  ): Promise<void> {
    await this.dataSource.query(
      `UPDATE ota_no_show_report
       SET result = $2, attempts = attempts + 1, reported_at = $3
       WHERE reservation_id = $1 AND result = 'PENDING'`,
      [reservationId, result, reportedAt],
    );
  }
}
