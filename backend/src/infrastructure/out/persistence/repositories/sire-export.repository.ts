import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { SireExportRepository } from '../../../../application/ports/out/sire-export.repository.js';
import type { Transaction } from '../../../../application/ports/out/transaction.js';
import type { SireExport } from '../../../../domain/migration/sire-export.js';
import {
  sireExportToDomain,
  sireExportToTable,
} from '../mappers/sire-export.mapper.js';
import { SireExportTable } from '../tables/sire-export.table.js';
import { managerFor } from '../typeorm-transaction.js';

@Injectable()
export class TypeOrmSireExportRepository implements SireExportRepository {
  constructor(private readonly dataSource: DataSource) {}

  async insert(sireExport: SireExport, tx?: Transaction): Promise<SireExport> {
    const manager = managerFor(this.dataSource, tx);
    await manager.insert(SireExportTable, sireExportToTable(sireExport));
    const saved = await manager.findOneBy(SireExportTable, {
      id: sireExport.id,
    });
    if (saved === null) {
      throw new Error(`La descarga SIRE ${sireExport.id} no quedó guardada.`);
    }
    return sireExportToDomain(saved);
  }

  async findById(id: string, tx?: Transaction): Promise<SireExport | null> {
    const row = await managerFor(this.dataSource, tx).findOneBy(
      SireExportTable,
      { id },
    );
    return row === null ? null : sireExportToDomain(row);
  }
}
