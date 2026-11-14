import { describe, expect, it } from 'vitest';
import { isValidRoomId } from '../../../../../src/application/use-cases/consult-room-inventory/room-id.validator.js';

/**
 * Datos de las pruebas del plan ("Pruebas por escenario", T002). Ningún plan trae un `roomId` con UUID:
 * es el `room_type_id` de Channex de los planes de `configure-ota` y `generate-ota-reservation`.
 */
const VALID_ROOM_ID = '994d1375-dbbd-4072-8724-b2ab32ce781b';

describe('isValidRoomId', () => {
  it('acepta un UUID', () => {
    expect(isValidRoomId(VALID_ROOM_ID)).toBe(true);
  });

  it('acepta un UUID con mayúsculas y minúsculas mezcladas', () => {
    expect(isValidRoomId('994D1375-dbbd-4072-8724-B2AB32ce781b')).toBe(true);
  });

  it('rechaza un roomId vacío', () => {
    expect(isValidRoomId('')).toBe(false);
  });

  it('rechaza un roomId con formato inválido (no es un UUID)', () => {
    expect(isValidRoomId('201')).toBe(false);
  });

  it.each([
    [
      'con un carácter de más al final',
      '994d1375-dbbd-4072-8724-b2ab32ce781b0',
    ],
    [
      'con un carácter de más al inicio',
      '0994d1375-dbbd-4072-8724-b2ab32ce781b',
    ],
    [
      'con una letra que no es hexadecimal',
      '994d1375-dbbd-4072-8724-b2ab32ce781g',
    ],
  ])('rechaza un UUID %s', (_, roomId) => {
    expect(isValidRoomId(roomId)).toBe(false);
  });
});
