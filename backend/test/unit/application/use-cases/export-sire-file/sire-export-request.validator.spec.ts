import { describe, expect, it } from 'vitest';
import { readSireExportRequest } from '../../../../../src/application/use-cases/export-sire-file/sire-export-request.validator.js';

const MAX_DAYS = 366;
const MOVEMENT_ID = '4b6c1f0e-2d3a-4e5f-8a9b-0c1d2e3f4a5b';

/** El `errorCode` con el que se rechaza el cuerpo. */
function rejectionOf(body: unknown): string {
  try {
    readSireExportRequest(body, MAX_DAYS);
  } catch (error) {
    return (error as { errorCode: string }).errorCode;
  }
  throw new Error('El cuerpo no se rechazó');
}

describe('readSireExportRequest (plan de export-sire-file, contrato A y tabla D)', () => {
  it('PERIOD: devuelve el periodo del ejemplo del contrato', () => {
    expect(
      readSireExportRequest(
        {
          exportKind: 'PERIOD',
          startDate: '2026-10-01',
          endDate: '2026-10-31',
        },
        MAX_DAYS,
      ),
    ).toEqual({
      exportKind: 'PERIOD',
      startDate: '2026-10-01',
      endDate: '2026-10-31',
    });
  });

  it('SINGLE_MOVEMENT: devuelve el movimiento, sin mirar fechas', () => {
    expect(
      readSireExportRequest(
        { exportKind: 'SINGLE_MOVEMENT', movementId: MOVEMENT_ID },
        MAX_DAYS,
      ),
    ).toEqual({ exportKind: 'SINGLE_MOVEMENT', movementId: MOVEMENT_ID });
  });

  it.each([
    ['sin cuerpo', undefined],
    ['un texto', 'PERIOD'],
    ['una lista', [{ exportKind: 'PERIOD' }]],
    ['sin exportKind', { startDate: '2026-10-01', endDate: '2026-10-31' }],
    ['otro tipo', { exportKind: 'MONTHLY' }],
    ['el tipo en minúsculas', { exportKind: 'period' }],
  ])('%s: INVALID_EXPORT_KIND', (_case, body) => {
    expect(rejectionOf(body)).toBe('INVALID_EXPORT_KIND');
  });

  it.each([
    ['sin endDate', { startDate: '2026-10-01' }, 'INCOMPLETE_DATE_RANGE'],
    [
      'con startDate nula',
      { startDate: null, endDate: '2026-10-31' },
      'INCOMPLETE_DATE_RANGE',
    ],
    [
      'con startDate vacía',
      { startDate: '', endDate: '2026-10-31' },
      'INCOMPLETE_DATE_RANGE',
    ],
    [
      'una fecha que no existe',
      { startDate: '2026-02-30', endDate: '2026-03-31' },
      'INVALID_DATE',
    ],
    [
      'una fecha numérica',
      { startDate: 20261001, endDate: '2026-10-31' },
      'INVALID_DATE',
    ],
    [
      'una fecha numérica y la otra ausente: primero falta',
      { startDate: 20261001 },
      'INCOMPLETE_DATE_RANGE',
    ],
    [
      'el periodo invertido',
      { startDate: '2026-10-31', endDate: '2026-10-01' },
      'INVALID_DATE_RANGE',
    ],
    [
      'más de un año',
      { startDate: '2026-01-01', endDate: '2027-01-02' },
      'PERIOD_TOO_LARGE',
    ],
  ])('PERIOD %s: %s', (_case, dates, errorCode) => {
    expect(rejectionOf({ exportKind: 'PERIOD', ...dates })).toBe(errorCode);
  });

  it('PERIOD de 366 días exactos es válido', () => {
    expect(
      readSireExportRequest(
        {
          exportKind: 'PERIOD',
          startDate: '2028-01-01',
          endDate: '2028-12-31',
        },
        MAX_DAYS,
      ),
    ).toMatchObject({ exportKind: 'PERIOD' });
  });

  it.each([
    ['sin movementId', {}],
    ['un movementId que no es UUID', { movementId: 'mov-1' }],
    ['un movementId numérico', { movementId: 42 }],
  ])('SINGLE_MOVEMENT %s: MOVEMENT_NOT_FOUND', (_case, fields) => {
    expect(rejectionOf({ exportKind: 'SINGLE_MOVEMENT', ...fields })).toBe(
      'MOVEMENT_NOT_FOUND',
    );
  });
});
