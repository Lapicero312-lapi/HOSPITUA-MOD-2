import { describe, expect, it } from 'vitest';
import {
  isValidRoomId,
  isValidStayDates,
} from '../../../../../src/application/use-cases/consult-maintenance-calendar/maintenance-request.validator.js';

/**
 * Ningún plan trae un `roomId` con UUID: es el `room_type_id` de Channex de los planes de `configure-ota`
 * y `generate-ota-reservation`.
 */
const VALID_ROOM_ID = '994d1375-dbbd-4072-8724-b2ab32ce781b';

describe('isValidRoomId', () => {
  it('acepta un UUID', () => {
    expect(isValidRoomId(VALID_ROOM_ID)).toBe(true);
  });

  it('rechaza un roomId vacío', () => {
    expect(isValidRoomId('')).toBe(false);
  });

  it('rechaza un roomId con formato inválido (no es un UUID)', () => {
    expect(isValidRoomId('201')).toBe(false);
  });
});

/**
 * Fechas del ejemplo del plan: estadía del 2026-10-11 al 2026-10-14. La fecha inexistente
 * (`2026-02-30`) es el ejemplo del plan de `check-view-reservation`, y la mal formada (`14/10/2026`) es
 * la salida del ejemplo en el formato de pantalla del plan base (`dd/mm/aaaa`).
 */
describe('isValidStayDates', () => {
  it('acepta fechas AAAA-MM-DD reales con la salida posterior a la llegada', () => {
    expect(isValidStayDates('2026-10-11', '2026-10-14')).toBe(true);
  });

  it('rechaza una salida anterior a la llegada', () => {
    expect(isValidStayDates('2026-10-14', '2026-10-11')).toBe(false);
  });

  it('rechaza una salida el mismo día de la llegada', () => {
    expect(isValidStayDates('2026-10-11', '2026-10-11')).toBe(false);
  });

  it('rechaza una fecha inexistente', () => {
    expect(isValidStayDates('2026-02-30', '2026-10-14')).toBe(false);
  });

  it('rechaza una fecha mal formada', () => {
    expect(isValidStayDates('2026-10-11', '14/10/2026')).toBe(false);
  });
});
