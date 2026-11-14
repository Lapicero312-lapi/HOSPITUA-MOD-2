import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  SireExport,
  type SireExportProps,
} from '../../../../src/domain/migration/sire-export.js';

/** La exportación del ejemplo de A del plan de `export-sire-file`. */
const PROPS: SireExportProps = {
  id: randomUUID(),
  exportDate: new Date('2026-11-01T14:05:00.000Z'),
  exportKind: 'PERIOD',
  recordsCount: 4,
  dateRangeStart: '2026-10-01',
  dateRangeEnd: '2026-10-31',
  processedBy: 'Ana Recepción',
};

describe('SireExport', () => {
  it('conserva los datos con los que se crea', () => {
    const sireExport = SireExport.restore(PROPS);

    expect(sireExport.snapshot()).toEqual(PROPS);
    expect({
      id: sireExport.id,
      exportDate: sireExport.exportDate,
      exportKind: sireExport.exportKind,
      recordsCount: sireExport.recordsCount,
      dateRangeStart: sireExport.dateRangeStart,
      dateRangeEnd: sireExport.dateRangeEnd,
      processedBy: sireExport.processedBy,
    }).toEqual(PROPS);
  });

  it('cambiar los datos de origen o la copia no la cambia: es inmutable', () => {
    const props = { ...PROPS };
    const sireExport = SireExport.restore(props);

    props.recordsCount = 99;
    sireExport.snapshot().processedBy = 'Otra';

    expect(sireExport.recordsCount).toBe(4);
    expect(sireExport.processedBy).toBe('Ana Recepción');
  });
});
