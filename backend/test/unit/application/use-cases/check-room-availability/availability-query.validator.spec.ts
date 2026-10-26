import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  hasExactlyCategoryOrRoomId,
  isValidExcludeReservationRef,
  isValidStayDates,
} from '../../../../../src/application/use-cases/check-room-availability/availability-query.validator.js';

/**
 * Datos de las pruebas del validador del plan ("Pruebas por escenario", T002): las fechas y la categoría
 * del ejemplo del DTO, y la referencia del ejemplo del plan base. El `roomId` es un UUID cualquiera.
 */
const ROOM_ID = randomUUID();

describe('isValidStayDates', () => {
  it('acepta fechas AAAA-MM-DD reales con la salida posterior a la llegada', () => {
    expect(isValidStayDates('2026-10-10', '2026-10-12')).toBe(true);
  });

  it('rechaza una salida anterior a la llegada', () => {
    expect(isValidStayDates('2026-10-12', '2026-10-10')).toBe(false);
  });

  it('rechaza una salida el mismo día de la llegada', () => {
    expect(isValidStayDates('2026-10-10', '2026-10-10')).toBe(false);
  });

  it('rechaza una fecha inexistente', () => {
    expect(isValidStayDates('2026-02-30', '2026-10-12')).toBe(false);
  });

  it('rechaza una fecha mal formada', () => {
    expect(isValidStayDates('2026-10-10', '12/10/2026')).toBe(false);
  });
});

describe('hasExactlyCategoryOrRoomId', () => {
  it('acepta solo la categoría', () => {
    expect(hasExactlyCategoryOrRoomId('DOBLE', undefined)).toBe(true);
  });

  it('acepta solo el roomId', () => {
    expect(hasExactlyCategoryOrRoomId(undefined, ROOM_ID)).toBe(true);
  });

  it('rechaza una consulta sin categoría ni roomId', () => {
    expect(hasExactlyCategoryOrRoomId(undefined, undefined)).toBe(false);
  });

  it('rechaza una consulta con la categoría y el roomId a la vez', () => {
    expect(hasExactlyCategoryOrRoomId('DOBLE', ROOM_ID)).toBe(false);
  });

  it('una categoría vacía cuenta como indicada: su formato no se revisa aquí', () => {
    expect(hasExactlyCategoryOrRoomId('', undefined)).toBe(true);
  });

  it('un roomId vacío cuenta como indicado: su formato no se revisa aquí', () => {
    expect(hasExactlyCategoryOrRoomId(undefined, '')).toBe(true);
  });
});

describe('isValidExcludeReservationRef', () => {
  it('sin excludeReservationRef, la consulta es válida', () => {
    expect(isValidExcludeReservationRef(undefined)).toBe(true);
  });

  it('acepta una referencia RSV- con 8 caracteres hexadecimales en mayúscula', () => {
    expect(isValidExcludeReservationRef('RSV-3F9A1C7B')).toBe(true);
  });

  it.each([
    ['en minúsculas', 'rsv-3f9a1c7b'],
    ['con 7 caracteres', 'RSV-3F9A1C7'],
    ['con un carácter que no es hexadecimal', 'RSV-3F9A1C7G'],
    ['sin RSV-', '3F9A1C7B'],
    ['vacía', ''],
  ])('rechaza una referencia %s', (_, reservationRef) => {
    expect(isValidExcludeReservationRef(reservationRef)).toBe(false);
  });
});
