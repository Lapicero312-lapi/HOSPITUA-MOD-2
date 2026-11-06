import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type {
  AriChange,
  AriPendingChange,
  AriPendingChangeRepository,
} from '../../../../application/ports/out/ari-pending-change.repository.js';
import type { Transaction } from '../../../../application/ports/out/transaction.js';
import { AriPendingChangeTable } from '../tables/ari-pending-change.table.js';
import { managerFor } from '../typeorm-transaction.js';

/**
 * `AriPendingChangeRepository` sobre la tabla `ari_pending_change` (la crea la migración base). El `id`
 * y `created_at` los pone la base (`gen_random_uuid()` y `now()`).
 */
@Injectable()
export class TypeOrmAriPendingChangeRepository implements AriPendingChangeRepository {
  constructor(private readonly dataSource: DataSource) {}

  async insert(changes: AriChange[], tx: Transaction): Promise<void> {
    if (changes.length === 0) {
      return;
    }
    // Un solo INSERT para todos los cambios: cada lista de unnest es una columna.
    await managerFor(this.dataSource, tx).query(
      `INSERT INTO ari_pending_change (category_room, date_from, date_to)
       SELECT * FROM unnest($1::varchar[], $2::date[], $3::date[])`,
      [
        changes.map((change) => change.categoryRoom),
        changes.map((change) => change.dateFrom),
        changes.map((change) => change.dateTo),
      ],
    );
  }

  async findAll(): Promise<AriPendingChange[]> {
    const rows = await this.dataSource.manager.find(AriPendingChangeTable, {
      // Con la misma hora, el orden no cambia de una lectura a otra.
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    return rows.map((row) => ({
      id: row.id,
      categoryRoom: row.categoryRoom,
      dateFrom: row.dateFrom,
      dateTo: row.dateTo,
    }));
  }

  async deleteByIds(ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    await this.dataSource.query(
      'DELETE FROM ari_pending_change WHERE id = ANY($1::uuid[])',
      [ids],
    );
  }
}
