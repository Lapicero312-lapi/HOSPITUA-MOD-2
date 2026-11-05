import { describe, expect, it } from 'vitest';
import { assertValidSirePeriod } from '../../../../../src/application/use-cases/export-sire-file/sire-period.validator.js';

/** `SIRE_MAX_PERIOD_DAYS` por defecto. Los datos salen del plan ("Pruebas por escenario", T003). */
const MAX_PERIOD_DAYS = 366;

const INCOMPLETE = expect.objectContaining({
  errorCode: 'INCOMPLETE_DATE_RANGE',
  message: 'Debe completar ambas fechas del rango.',
});
const INVALID_DATE = expect.objectContaining({
  errorCode: 'INVALID_DATE',
  message: 'La fecha indicada no es válida.',
});
const INVERTED = expect.objectContaining({
  errorCode: 'INVALID_DATE_RANGE',
  message: 'La fecha inicial no puede ser posterior a la fecha final.',
});
const TOO_LARGE = expect.objectContaining({
  errorCode: 'PERIOD_TOO_LARGE',
  message:
    'El periodo solicitado excede el límite permitido. Por favor exporte periodos más cortos.',
});

const validate =
  (startDate: string | undefined, endDate: string | undefined) => () =>
    assertValidSirePeriod(startDate, endDate, MAX_PERIOD_DAYS);

describe('assertValidSirePeriod', () => {
  it.each([
    ['el ejemplo del plan', '2026-10-01', '2026-10-31'],
    ['un solo día', '2026-10-01', '2026-10-01'],
    ['un año de 365 días', '2026-01-01', '2026-12-31'],
    ['justo 366 días, el límite', '2026-01-01', '2027-01-01'],
    ['un 29 de febrero real', '2028-02-29', '2028-03-01'],
  ])('acepta %s', (_, startDate, endDate) => {
    expect(validate(startDate, endDate)).not.toThrow();
  });

  it.each([
    ['sin la inicial', undefined, '2026-10-31'],
    ['sin la final', '2026-10-01', undefined],
    ['sin ninguna', undefined, undefined],
    ['con la inicial vacía', '', '2026-10-31'],
    ['con la final vacía', '2026-10-01', ''],
  ])('%s es INCOMPLETE_DATE_RANGE', (_, startDate, endDate) => {
    expect(validate(startDate, endDate)).toThrow(INCOMPLETE);
  });

  it.each([
    ['un día que ese mes no tiene, en la inicial', '2026-02-30', '2026-03-01'],
    ['un día que ese mes no tiene, en la final', '2026-02-01', '2026-02-30'],
    ['un mes que no existe', '2026-13-01', '2026-13-02'],
    ['otro formato', '01/10/2026', '2026-10-31'],
    ['sin ceros a la izquierda', '2026-10-1', '2026-10-31'],
    ['texto antes de la fecha', 'x2026-10-01', '2026-10-31'],
    ['texto después de la fecha', '2026-10-01', '2026-10-31x'],
    [
      'un 29 de febrero en un año que no es bisiesto',
      '2027-02-29',
      '2027-03-01',
    ],
  ])('%s es INVALID_DATE', (_, startDate, endDate) => {
    expect(validate(startDate, endDate)).toThrow(INVALID_DATE);
  });

  it('la fecha inicial posterior a la final es INVALID_DATE_RANGE', () => {
    expect(validate('2026-10-31', '2026-10-01')).toThrow(INVERTED);
  });

  it('367 días, uno más que el límite, es PERIOD_TOO_LARGE', () => {
    expect(validate('2026-01-01', '2027-01-02')).toThrow(TOO_LARGE);
  });

  it('usa el máximo que recibe, no uno fijo', () => {
    expect(() =>
      assertValidSirePeriod('2026-10-01', '2026-10-07', 7),
    ).not.toThrow();
    expect(() => assertValidSirePeriod('2026-10-01', '2026-10-08', 7)).toThrow(
      TOO_LARGE,
    );
  });

  describe('revisa en el orden del plan', () => {
    it('primero que estén las dos fechas, aunque la otra esté mal formada', () => {
      expect(validate(undefined, 'no-es-fecha')).toThrow(INCOMPLETE);
    });

    it('después que sean reales, aunque estén invertidas', () => {
      expect(validate('2026-10-31', '2026-02-30')).toThrow(INVALID_DATE);
    });

    it('después el orden, aunque entre ellas haya más del máximo', () => {
      expect(validate('2028-01-01', '2026-01-01')).toThrow(INVERTED);
    });
  });
});
