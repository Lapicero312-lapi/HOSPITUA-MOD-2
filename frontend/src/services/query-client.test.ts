import { describe, expect, it } from 'vitest';
import {
  ApiError,
  CONNECTION_ERROR,
  CONNECTION_ERROR_MESSAGE,
} from './api-client.ts';
import { createQueryClient, shouldRetryQuery } from './query-client.ts';

describe('shouldRetryQuery', () => {
  const connection = new ApiError(
    CONNECTION_ERROR,
    CONNECTION_ERROR_MESSAGE,
    null,
  );

  it('sin conexión reintenta una sola vez', () => {
    expect(shouldRetryQuery(0, connection)).toBe(true);
    expect(shouldRetryQuery(1, connection)).toBe(false);
  });

  it('un error de la API (4xx) no se reintenta: se repetiría igual', () => {
    expect(
      shouldRetryQuery(
        0,
        new ApiError('INVALID_STATUS', 'El estado indicado no es válido.', 400),
      ),
    ).toBe(false);
  });

  it('un error que no es de la API no se reintenta', () => {
    expect(shouldRetryQuery(0, new Error('fallo de la pantalla'))).toBe(false);
  });
});

it('las escrituras (crear, modificar, cancelar) nunca se reintentan solas', () => {
  expect(createQueryClient().getDefaultOptions().mutations?.retry).toBe(false);
});
