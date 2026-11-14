import { describe, expect, it } from 'vitest';
import { isValidCategoryRoom } from '../../../../../src/application/use-cases/consult-room-inventory/category-room.validator.js';

/** Datos de las pruebas del plan ("Pruebas por escenario", T002), que dice de dónde sale cada uno. */
describe('isValidCategoryRoom', () => {
  it.each([
    ['DOBLE', 'DOBLE'],
    ['SUITE_JUNIOR', 'SUITE_JUNIOR'],
    ['con un dígito (DOBLE_2)', 'DOBLE_2'],
    ['de 50 caracteres, el máximo', 'A'.repeat(50)],
  ])('acepta la categoría %s', (_, categoryRoom) => {
    expect(isValidCategoryRoom(categoryRoom)).toBe(true);
  });

  it.each([
    ['vacía', ''],
    ['en minúsculas (doble)', 'doble'],
    ['con Ñ (CABAÑA)', 'CABAÑA'],
    ['con tilde (DÚPLEX)', 'DÚPLEX'],
    ['con espacio (SUITE JUNIOR)', 'SUITE JUNIOR'],
    ['con guion (SUITE-JUNIOR)', 'SUITE-JUNIOR'],
    ['de 51 caracteres', 'A'.repeat(51)],
  ])('rechaza una categoría %s', (_, categoryRoom) => {
    expect(isValidCategoryRoom(categoryRoom)).toBe(false);
  });
});
