import { describe, expect, it } from 'vitest';
import { readSireMovementsQuery } from '../../../../../src/application/use-cases/export-sire-file/sire-movements-query.validator.js';

const MAX_DAYS = 366;
const OCTOBER = { startDate: '2026-10-01', endDate: '2026-10-31' };

/** El `errorCode` con el que se rechazan los parámetros. */
function rejectionOf(query: unknown): string {
  try {
    readSireMovementsQuery(query, MAX_DAYS);
  } catch (error) {
    return (error as { errorCode: string }).errorCode;
  }
  throw new Error('Los parámetros no se rechazaron');
}

describe('readSireMovementsQuery (plan de export-sire-file, contrato B y tabla D)', () => {
  it('sin page devuelve el periodo y la página 1', () => {
    expect(readSireMovementsQuery(OCTOBER, MAX_DAYS)).toEqual({
      startDate: '2026-10-01',
      endDate: '2026-10-31',
      page: 1,
    });
  });

  it.each([
    ['1', 1],
    ['2', 2],
    ['37', 37],
  ])('page=%s es la página %i', (page, expected) => {
    expect(readSireMovementsQuery({ ...OCTOBER, page }, MAX_DAYS).page).toBe(
      expected,
    );
  });

  it('ignora los parámetros ajenos', () => {
    expect(
      readSireMovementsQuery(
        { ...OCTOBER, page: '2', pageSize: '500', exportKind: 'X' },
        MAX_DAYS,
      ),
    ).toEqual({ startDate: '2026-10-01', endDate: '2026-10-31', page: 2 });
  });

  it('acepta un periodo de un día y uno de SIRE_MAX_PERIOD_DAYS días (las dos fechas cuentan)', () => {
    expect(
      readSireMovementsQuery(
        { startDate: '2026-10-01', endDate: '2026-10-01' },
        MAX_DAYS,
      ),
    ).toMatchObject({ startDate: '2026-10-01', endDate: '2026-10-01' });
    expect(
      readSireMovementsQuery(
        { startDate: '2026-01-01', endDate: '2027-01-01' },
        MAX_DAYS,
      ),
    ).toMatchObject({ startDate: '2026-01-01', endDate: '2027-01-01' });
  });

  describe('el periodo, con las mismas reglas de A', () => {
    it.each([
      ['sin parámetros', undefined, 'INCOMPLETE_DATE_RANGE'],
      ['sin ninguna fecha', {}, 'INCOMPLETE_DATE_RANGE'],
      [
        'solo con startDate',
        { startDate: '2026-10-01' },
        'INCOMPLETE_DATE_RANGE',
      ],
      ['solo con endDate', { endDate: '2026-10-31' }, 'INCOMPLETE_DATE_RANGE'],
      [
        'con endDate vacía',
        { startDate: '2026-10-01', endDate: '' },
        'INCOMPLETE_DATE_RANGE',
      ],
      [
        'con una fecha que no existe',
        { startDate: '2026-02-30', endDate: '2026-03-31' },
        'INVALID_DATE',
      ],
      [
        'con una fecha en otro formato',
        { startDate: '01/10/2026', endDate: '2026-10-31' },
        'INVALID_DATE',
      ],
      [
        'con startDate repetida (llega como lista)',
        { startDate: ['2026-10-01', '2026-10-02'], endDate: '2026-10-31' },
        'INVALID_DATE',
      ],
      [
        'invertido',
        { startDate: '2026-10-31', endDate: '2026-10-01' },
        'INVALID_DATE_RANGE',
      ],
      [
        'de SIRE_MAX_PERIOD_DAYS + 1 días',
        { startDate: '2026-01-01', endDate: '2027-01-02' },
        'PERIOD_TOO_LARGE',
      ],
    ])('%s: %s', (_case, query, errorCode) => {
      expect(rejectionOf(query)).toBe(errorCode);
    });

    it('se revisa antes que la página', () => {
      expect(
        rejectionOf({
          startDate: '2026-10-31',
          endDate: '2026-10-01',
          page: '0',
        }),
      ).toBe('INVALID_DATE_RANGE');
    });
  });

  it.each([
    ['0', '0'],
    ['negativa', '-1'],
    ['decimal', '1.5'],
    ['con exponente', '1e2'],
    ['con espacios', ' 1'],
    ['vacía', ''],
    ['que no es un número', 'dos'],
    ['repetida (llega como lista)', ['1', '2']],
    ['más grande que el mayor entero seguro', '9007199254740992'],
  ])('page %s es INVALID_PAGE', (_case, page) => {
    expect(rejectionOf({ ...OCTOBER, page })).toBe('INVALID_PAGE');
  });

  it('INVALID_PAGE sale con el mensaje literal de la tabla D', () => {
    expect(() =>
      readSireMovementsQuery({ ...OCTOBER, page: '0' }, MAX_DAYS),
    ).toThrow(
      expect.objectContaining({
        errorCode: 'INVALID_PAGE',
        message: 'El número de página debe ser 1 o mayor.',
      }),
    );
  });
});
