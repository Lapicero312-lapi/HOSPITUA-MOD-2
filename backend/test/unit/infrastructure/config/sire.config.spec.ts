import { describe, expect, it } from 'vitest';
import {
  SIRE_DEFAULTS,
  sireConfigFrom,
} from '../../../../src/infrastructure/config/sire.config.js';

/** Las variables por defecto del plan, con un hotel y una ciudad. */
function variables(changes: Record<string, unknown> = {}) {
  return {
    ...SIRE_DEFAULTS,
    SIRE_HOTEL_CODE: '123456',
    SIRE_CITY_CODE: '11001',
    ...changes,
  } as Parameters<typeof sireConfigFrom>[0];
}

describe('sireConfigFrom (plan de export-sire-file, "Configuración del formato")', () => {
  it('con los valores por defecto: el tabulador, dd/MM/yyyy, CRLF, utf-8, 366 días y 50 000 líneas', () => {
    expect(sireConfigFrom(variables())).toEqual({
      format: {
        hotelCode: '123456',
        cityCode: '11001',
        fieldSeparator: '\t',
        dateFormat: 'dd/MM/yyyy',
        encoding: 'utf-8',
      },
      lineBreak: '\r\n',
      maxPeriodDays: 366,
      maxRecords: 50000,
    });
  });

  it('otro separador pasa tal cual, LF es \\n y latin1 se conserva', () => {
    const config = sireConfigFrom(
      variables({
        SIRE_FIELD_SEPARATOR: '|',
        SIRE_LINE_BREAK: 'LF',
        SIRE_FILE_ENCODING: 'latin1',
        SIRE_DATE_FORMAT: 'yyyy-MM-dd',
        SIRE_MAX_PERIOD_DAYS: 31,
        SIRE_MAX_RECORDS: 10,
      }),
    );

    expect(config).toMatchObject({
      format: {
        fieldSeparator: '|',
        dateFormat: 'yyyy-MM-dd',
        encoding: 'latin1',
      },
      lineBreak: '\n',
      maxPeriodDays: 31,
      maxRecords: 10,
    });
  });
});
