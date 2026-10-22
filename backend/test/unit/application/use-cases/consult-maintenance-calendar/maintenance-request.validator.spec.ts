import { describe, expect, it } from 'vitest';
import { isValidRoomId } from '../../../../../src/application/use-cases/consult-maintenance-calendar/maintenance-request.validator.js';

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
