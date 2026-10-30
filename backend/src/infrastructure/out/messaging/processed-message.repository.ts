import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type {
  ProcessedMessage,
  ProcessedMessageRepository,
} from '../../../application/ports/out/processed-message.repository.js';
import type { Transaction } from '../../../application/ports/out/transaction.js';
import { managerFor } from '../persistence/typeorm-transaction.js';

/**
 * `ProcessedMessageRepository` sobre la tabla `processed_message` (la crea la migración base). Siempre
 * escribe en la transacción del consumidor: nunca registra un mensaje sin su cambio.
 */
@Injectable()
export class TypeOrmProcessedMessageRepository implements ProcessedMessageRepository {
  constructor(private readonly dataSource: DataSource) {}

  async isProcessed(messageId: string, tx: Transaction): Promise<boolean> {
    const rows: unknown[] = await managerFor(this.dataSource, tx).query(
      'SELECT 1 FROM processed_message WHERE message_id = $1',
      [messageId],
    );
    return rows.length > 0;
  }

  async record(message: ProcessedMessage, tx: Transaction): Promise<void> {
    // processed_at toma now() de la base; un messageId repetido lo rechaza la clave primaria.
    await managerFor(this.dataSource, tx).query(
      `INSERT INTO processed_message (message_id, queue, sequence_number)
       VALUES ($1, $2, $3)`,
      [message.messageId, message.queue, message.sequenceNumber],
    );
  }
}
