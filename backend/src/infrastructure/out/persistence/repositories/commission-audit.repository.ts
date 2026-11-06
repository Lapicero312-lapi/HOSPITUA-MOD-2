import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type {
  CommissionAuditEntry,
  CommissionAuditRepository,
} from '../../../../application/ports/out/commission-audit.repository.js';
import type { Transaction } from '../../../../application/ports/out/transaction.js';
import { managerFor } from '../typeorm-transaction.js';

/**
 * `CommissionAuditRepository` sobre la tabla `commission_audit` (la crea la migración base). El `id` y
 * `occurred_at` los pone la base (`gen_random_uuid()` y `now()`), como en `processed_message`.
 */
@Injectable()
export class TypeOrmCommissionAuditRepository implements CommissionAuditRepository {
  constructor(private readonly dataSource: DataSource) {}

  async record(entry: CommissionAuditEntry, tx: Transaction): Promise<void> {
    await managerFor(this.dataSource, tx).query(
      `INSERT INTO commission_audit
         (reservation_id, ota_id, action, previous_status, gross_amount,
          commission_percentage, commission_amount, channel, performed_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        entry.reservationId,
        entry.otaId,
        entry.action,
        entry.previousStatus,
        entry.grossAmount.amount,
        entry.commissionPercentage,
        entry.commissionAmount.amount,
        entry.channel,
        entry.performedBy,
      ],
    );
  }

  async existsFor(reservationId: string, tx: Transaction): Promise<boolean> {
    const [{ exists }]: { exists: boolean }[] = await managerFor(
      this.dataSource,
      tx,
    ).query(
      'SELECT EXISTS (SELECT 1 FROM commission_audit WHERE reservation_id = $1) AS exists',
      [reservationId],
    );
    return exists;
  }
}
