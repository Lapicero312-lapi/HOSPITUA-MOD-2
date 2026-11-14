import { describe, expect, it } from 'vitest';
import {
  readClient,
  readUser,
} from '../../../../../src/infrastructure/in/rest/request-headers.js';

const INVALID_CLIENT = expect.objectContaining({
  errorCode: 'INVALID_CLIENT',
  message: 'La ruta no admite el cliente indicado en X-Client.',
  status: 400,
});

describe('readClient', () => {
  it.each(['RECEPTIONIST', 'MODULE1', 'MODULE3'])(
    'sin restricción, admite %s',
    (client) => {
      expect(readClient(client)).toBe(client);
    },
  );

  it.each([
    ['sin cabecera', undefined],
    ['vacía', ''],
    ['con otro valor', 'OTA'],
    ['en minúsculas', 'receptionist'],
    ['repetida (llega como lista)', ['RECEPTIONIST', 'MODULE1']],
  ])('%s es INVALID_CLIENT', (_, header) => {
    expect(() => readClient(header)).toThrow(INVALID_CLIENT);
  });

  it('un cliente que la ruta no admite es INVALID_CLIENT', () => {
    expect(() => readClient('MODULE3', ['RECEPTIONIST', 'MODULE1'])).toThrow(
      INVALID_CLIENT,
    );
    expect(readClient('MODULE1', ['RECEPTIONIST', 'MODULE1'])).toBe('MODULE1');
  });
});

describe('readUser', () => {
  it('devuelve el usuario tal cual, para guardarlo en processed_by', () => {
    expect(readUser('laura.mendez')).toBe('laura.mendez');
    expect(readUser(' Laura Méndez ')).toBe(' Laura Méndez ');
  });

  it('acepta hasta 100 caracteres, lo que cabe en processed_by', () => {
    expect(readUser('a'.repeat(100))).toHaveLength(100);
  });

  it.each([
    ['sin cabecera', undefined],
    ['vacía', ''],
    ['solo con espacios', '   '],
    ['repetida (llega como lista)', ['laura', 'ana']],
  ])('%s es USER_REQUIRED', (_, header) => {
    expect(() => readUser(header)).toThrow(
      expect.objectContaining({
        errorCode: 'USER_REQUIRED',
        message: 'Falta el usuario que hace la acción.',
      }),
    );
  });

  it('con más de 100 caracteres es INVALID_USER', () => {
    expect(() => readUser('a'.repeat(101))).toThrow(
      expect.objectContaining({
        errorCode: 'INVALID_USER',
        message: 'El usuario que hace la acción no es válido.',
      }),
    );
  });
});
