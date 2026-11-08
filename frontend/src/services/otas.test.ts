import { afterEach, describe, expect, it, vi } from 'vitest';
import { listOtas } from './otas.ts';

describe('listOtas', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('consulta el contrato GET /api/otas', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [],
          total: 0,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(listOtas()).resolves.toEqual({ items: [], total: 0 });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/otas',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Accept: 'application/json',
          'X-Client': 'RECEPTIONIST',
        }),
      }),
    );
  });
});
