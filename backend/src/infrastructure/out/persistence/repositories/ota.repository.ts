import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import {
  DuplicateOtaError,
  type OtaOverview,
  type OtaRepository,
} from '../../../../application/ports/out/ota.repository.js';
import type { Transaction } from '../../../../application/ports/out/transaction.js';
import type { Ota } from '../../../../domain/ota/ota.js';
import type {
  ConnectionStatus,
  ReservationStatus,
} from '../../../../domain/shared/enums.js';
import { decimalText } from '../mappers/decimal-text.js';
import { otaToDomain, otaToTable } from '../mappers/ota.mapper.js';
import { OtaTable } from '../tables/ota.table.js';
import { managerFor } from '../typeorm-transaction.js';

/** Las reservas que cuentan en `activeReservations` (plan de `register-ota-information-commission`, A3). */
const ACTIVE_RESERVATION_STATUSES: readonly ReservationStatus[] = [
  'PENDING',
  'ACTIVE',
  'IN_PROGRESS',
];

/** A3: los datos de cada agencia y el conteo de sus reservas activas. `$1` son esos estados. */
const OVERVIEW_SELECT = `
  SELECT o.id, o.name, o.commission_percentage, o.connection_status,
         o.linked_at, o.last_sync_at,
         (SELECT count(*)::int
            FROM reservation r
           WHERE r.ota_id = o.id AND r.status = ANY($1::text[])) AS active_reservations
    FROM ota o`;

type OverviewRow = {
  id: string;
  name: string;
  commission_percentage: string | null;
  connection_status: string;
  linked_at: Date;
  last_sync_at: Date;
  active_reservations: number;
};

@Injectable()
export class TypeOrmOtaRepository implements OtaRepository {
  constructor(private readonly dataSource: DataSource) {}

  findById(id: string, tx?: Transaction): Promise<Ota | null> {
    return findOne(managerFor(this.dataSource, tx), { id });
  }

  findByName(name: string, tx?: Transaction): Promise<Ota | null> {
    return findOne(managerFor(this.dataSource, tx), { name });
  }

  async insert(ota: Ota, tx?: Transaction): Promise<Ota> {
    const manager = managerFor(this.dataSource, tx);
    try {
      await manager.insert(OtaTable, otaToTable(ota));
    } catch (error) {
      throw translateDuplicate(error);
    }
    return findOrFail(manager, ota.id);
  }

  async update(ota: Ota, tx?: Transaction): Promise<Ota> {
    const manager = managerFor(this.dataSource, tx);
    const row = otaToTable(ota);
    try {
      await manager.query(
        `UPDATE ota SET
           name = $2, commission_percentage = $3, connection_status = $4,
           linked_at = $5, last_sync_at = $6, updated_at = now()
         WHERE id = $1`,
        [
          row.id,
          row.name,
          row.commissionPercentage,
          row.connectionStatus,
          row.linkedAt,
          row.lastSyncAt,
        ],
      );
    } catch (error) {
      throw translateDuplicate(error);
    }
    return findOrFail(manager, ota.id);
  }

  async updateConnection(
    id: string,
    connectionStatus: ConnectionStatus,
    lastSyncAt?: Date,
  ): Promise<void> {
    if (lastSyncAt === undefined) {
      await this.dataSource.query(
        'UPDATE ota SET connection_status = $2, updated_at = now() WHERE id = $1',
        [id, connectionStatus],
      );
      return;
    }
    await this.dataSource.query(
      `UPDATE ota SET connection_status = $2, last_sync_at = $3, updated_at = now()
       WHERE id = $1`,
      [id, connectionStatus, lastSyncAt],
    );
  }

  async listOverviews(): Promise<OtaOverview[]> {
    const rows: OverviewRow[] = await this.dataSource.query(
      `${OVERVIEW_SELECT}
       ORDER BY o.name`,
      [ACTIVE_RESERVATION_STATUSES],
    );
    return rows.map(overviewOf);
  }

  async findOverviewById(id: string): Promise<OtaOverview | null> {
    const rows: OverviewRow[] = await this.dataSource.query(
      `${OVERVIEW_SELECT}
       WHERE o.id = $2`,
      [ACTIVE_RESERVATION_STATUSES, id],
    );
    return rows.length === 0 ? null : overviewOf(rows[0]);
  }
}

function overviewOf(row: OverviewRow): OtaOverview {
  return {
    id: row.id,
    name: row.name,
    commissionPercentage:
      row.commission_percentage === null
        ? null
        : decimalText(row.commission_percentage),
    connectionStatus: row.connection_status as ConnectionStatus,
    linkedAt: row.linked_at,
    lastSyncAt: row.last_sync_at,
    activeReservations: row.active_reservations,
  };
}

async function findOne(
  manager: EntityManager,
  where: Partial<Pick<OtaTable, 'id' | 'name'>>,
): Promise<Ota | null> {
  const row = await manager.findOneBy(OtaTable, where);
  return row ? otaToDomain(row) : null;
}

async function findOrFail(manager: EntityManager, id: string): Promise<Ota> {
  const ota = await findOne(manager, { id });
  if (!ota) {
    throw new Error(`La agencia ${id} no se encontró después de guardarla.`);
  }
  return ota;
}

/** El único de `ota` (`name`) como `DuplicateOtaError`. */
function translateDuplicate(error: unknown): unknown {
  if (error instanceof QueryFailedError) {
    const { code, constraint } = error.driverError as {
      code?: string;
      constraint?: string;
    };
    if (code === '23505' && constraint === 'uq_ota_name') {
      return new DuplicateOtaError('name');
    }
  }
  return error;
}
