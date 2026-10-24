import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  apiRequest,
  CONNECTION_ERROR,
  CONNECTION_ERROR_MESSAGE,
} from './api-client.ts';

const fetchMock = vi.fn<typeof fetch>();

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('apiRequest', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  it('llama a la ruta con el prefijo /api y X-Client: RECEPTIONIST, y devuelve el JSON', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: [] }));

    const result = await apiRequest<{ items: unknown[] }>(
      '/reservations?page=1',
    );

    expect(result).toEqual({ items: [] });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/reservations?page=1');
    expect(init?.method).toBe('GET');
    expect(init?.headers).toMatchObject({ 'X-Client': 'RECEPTIONIST' });
  });

  it('envía el cuerpo como JSON y suma las cabeceras de quien llama', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 201));

    await apiRequest('/reservations/direct', {
      method: 'POST',
      body: { startDate: '2026-11-10' },
      headers: { 'Idempotency-Key': 'clave' },
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(init?.body).toBe('{"startDate":"2026-11-10"}');
    expect(init?.headers).toMatchObject({
      'Content-Type': 'application/json',
      'Idempotency-Key': 'clave',
      'X-Client': 'RECEPTIONIST',
    });
  });

  it('un error de la API es ApiError con el código, el mensaje y el estado que envió el backend', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          errorCode: 'RESERVATION_NOT_FOUND',
          message: 'La reserva no existe.',
          timestamp: '2026-10-24T14:00:00.000Z',
          path: '/api/reservations/RSV-00000000',
        },
        400,
      ),
    );

    await expect(apiRequest('/reservations/RSV-00000000')).rejects.toEqual(
      new ApiError('RESERVATION_NOT_FOUND', 'La reserva no existe.', 400),
    );
  });

  it('sin respuesta del servidor es CONNECTION_ERROR con su mensaje', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(apiRequest('/reservations')).rejects.toEqual(
      new ApiError(CONNECTION_ERROR, CONNECTION_ERROR_MESSAGE, null),
    );
  });

  it('un error sin el cuerpo de la API (por ejemplo, el backend apagado) es CONNECTION_ERROR', async () => {
    fetchMock.mockResolvedValue(new Response('Bad Gateway', { status: 502 }));

    await expect(apiRequest('/reservations')).rejects.toMatchObject({
      errorCode: CONNECTION_ERROR,
      status: 502,
    });
  });

  it('una consulta cancelada no se convierte en error de conexión', async () => {
    const aborted = new DOMException(
      'The operation was aborted.',
      'AbortError',
    );
    fetchMock.mockRejectedValue(aborted);

    await expect(apiRequest('/reservations')).rejects.toBe(aborted);
  });

  it('una respuesta 204 no tiene cuerpo', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await expect(
      apiRequest('/algo', { method: 'POST' }),
    ).resolves.toBeUndefined();
  });
});
