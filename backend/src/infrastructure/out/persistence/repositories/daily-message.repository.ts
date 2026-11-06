import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type {
  DailyMessage,
  DailyMessageRepository,
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
}
