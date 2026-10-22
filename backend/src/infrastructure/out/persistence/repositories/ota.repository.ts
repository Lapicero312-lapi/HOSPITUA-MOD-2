import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import {
  DuplicateOtaError,
  type OtaRepository,
} from '../../../../application/ports/out/ota.repository.js';
import type { Transaction } from '../../../../application/ports/out/transaction.js';
import type { Ota } from '../../../../domain/ota/ota.js';
import { otaToDomain, otaToTable } from '../mappers/ota.mapper.js';
import { OtaTable } from '../tables/ota.table.js';
import { managerFor } from '../typeorm-transaction.js';

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
           name = $2, hotel_account_id = $3, commission_percentage = $4, connection_status = $5,
           linked_at = $6, last_sync_at = $7, updated_at = now()
         WHERE id = $1`,
        [
          row.id,
          row.name,
          row.hotelAccountId,
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

/** Los únicos de `ota` (`name` y `hotel_account_id`) como `DuplicateOtaError`. */
function translateDuplicate(error: unknown): unknown {
  if (error instanceof QueryFailedError) {
    const { code, constraint } = error.driverError as {
      code?: string;
      constraint?: string;
    };
    if (code === '23505' && constraint === 'uq_ota_name') {
      return new DuplicateOtaError('name');
    }
    if (code === '23505' && constraint === 'uq_ota_hotel_account_id') {
      return new DuplicateOtaError('hotelAccountId');
    }
  }
  return error;
}
