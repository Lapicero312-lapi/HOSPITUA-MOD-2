import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type {
  DailyMessage,
  DailyMessageRepository,
  UnpublishedDailyMessage,
} from '../../../../application/ports/out/daily-message.repository.js';
import type { Transaction } from '../../../../application/ports/out/transaction.js';
import { managerFor } from '../typeorm-transaction.js';

/**
 * `DailyMessageRepository` sobre la tabla `daily_list_message` (la crea la migración base). `attempts` y
 * `created_at` los pone la base (`DEFAULT 0` y `now()`).
 */
@Injectable()
export class TypeOrmDailyMessageRepository implements DailyMessageRepository {
  constructor(private readonly dataSource: DataSource) {}

  async insert(message: DailyMessage, tx: Transaction): Promise<void> {
    await managerFor(this.dataSource, tx).query(
      `INSERT INTO daily_list_message
         (message_id, operational_date, sequence_number, message_kind, update_type,
          reservation_id, removal_reason, payload, publish_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, 'PENDING')`,
      [
        message.messageId,
        message.operationalDate,
        message.sequenceNumber,
        message.kind,
        message.updateType,
        message.reservationId,
        message.removalReason,
        JSON.stringify(message.payload),
      ],
    );
  }

  async findUnpublished(limit: number): Promise<UnpublishedDailyMessage[]> {
    // Las fechas salen con `to_char`, para no depender de cómo `pg` convierte `date` y `timestamptz`.
    const rows: {
      message_id: string;
      operational_date: string;
      sequence_number: number;
      message_kind: 'LIST' | 'UPDATE';
      payload: object;
      publish_status: 'PENDING' | 'FAILED';
      attempts: number;
      next_attempt_at: string | null;
    }[] = await this.dataSource.query(
      `SELECT message_id, to_char(operational_date, 'YYYY-MM-DD') AS operational_date,
              sequence_number, message_kind, payload, publish_status, attempts,
              to_char(next_attempt_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS next_attempt_at
       FROM daily_list_message
       WHERE publish_status IN ('PENDING', 'FAILED')
       ORDER BY operational_date, sequence_number
       LIMIT $1`,
      [limit],
    );
    return rows.map((row) => ({
      messageId: row.message_id,
      operationalDate: row.operational_date,
      sequenceNumber: row.sequence_number,
      kind: row.message_kind,
      payload: row.payload,
      publishStatus: row.publish_status,
      attempts: row.attempts,
      nextAttemptAt:
        row.next_attempt_at === null ? null : new Date(row.next_attempt_at),
    }));
  }

  async markPublished(messageId: string, publishedAt: Date): Promise<void> {
    await this.dataSource.query(
      `UPDATE daily_list_message
       SET publish_status = 'PUBLISHED', published_at = $2
       WHERE message_id = $1`,
      [messageId, publishedAt],
    );
  }

  async recordFailure(
    messageId: string,
    attempts: number,
    status: 'PENDING' | 'FAILED',
    nextAttemptAt: Date | null,
  ): Promise<void> {
    await this.dataSource.query(
      `UPDATE daily_list_message
       SET attempts = $2, publish_status = $3, next_attempt_at = $4
       WHERE message_id = $1`,
      [messageId, attempts, status, status === 'FAILED' ? null : nextAttemptAt],
    );
  }
}
