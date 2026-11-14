import {
  SireExport,
  type SireExportKind,
} from '../../../../domain/migration/sire-export.js';
import { SireExportTable } from '../tables/sire-export.table.js';

export function sireExportToDomain(row: SireExportTable): SireExport {
  return SireExport.restore({
    id: row.id,
    exportDate: row.exportDate,
    exportKind: row.exportKind as SireExportKind,
    recordsCount: row.recordsCount,
    dateRangeStart: row.dateRangeStart,
    dateRangeEnd: row.dateRangeEnd,
    processedBy: row.processedBy,
  });
}

export function sireExportToTable(sireExport: SireExport): SireExportTable {
  return Object.assign(new SireExportTable(), sireExport.snapshot());
}
