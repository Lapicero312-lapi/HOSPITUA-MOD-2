import { describe, expect, it } from 'vitest';
import {
  isValidCategoryRoom,
  isValidStayDates,
} from '../../../../../src/application/use-cases/calculate-dynamic-rate/quote-request.validator.js';

describe('Validadores de la cotización (T005)', () => {
  describe('isValidCategoryRoom: la forma acordada de categoryRoom', () => {
    it.each(['DOBLE', 'SUITE_JUNIOR', 'A1', 'X'.repeat(50)])(
      '%s es válida',
      (categoryRoom) => {
        expect(isValidCategoryRoom(categoryRoom)).toBe(true);
      },
    );

    it.each([
      ['vacía', ''],
      ['en minúsculas', 'doble'],
      ['con tilde', 'DOBLÉ'],
      ['con Ñ', 'MONTAÑA'],
      ['con espacio', 'SUITE JUNIOR'],
      ['de 51 caracteres', 'X'.repeat(51)],
    ])('%s no es válida', (_caso, categoryRoom) => {
      expect(isValidCategoryRoom(categoryRoom)).toBe(false);
    });
  });

  describe('isValidStayDates', () => {
    it('del 2026-10-10 al 2026-10-12 (ejemplo de A1) es válido', () => {
      expect(isValidStayDates('2026-10-10', '2026-10-12')).toBe(true);
    });

    it.each([
      ['la salida antes de la llegada', '2026-10-12', '2026-10-10'],
      ['la salida el mismo día de la llegada', '2026-10-10', '2026-10-10'],
      ['una fecha que no existe', '2026-02-30', '2026-03-02'],
      ['una fecha con otra forma', '10/10/2026', '2026-10-12'],
      ['una fecha sin el día', '2026-10', '2026-10-12'],
    ])('%s no es válido', (_caso, startDate, endDate) => {
      expect(isValidStayDates(startDate, endDate)).toBe(false);
    });
  });
});
