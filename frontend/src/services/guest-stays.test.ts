import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from './api-client.ts';
import { getGuestStayDetail, listGuestStays } from './guest-stays.ts';

vi.mock('./api-client.ts', () => ({
  apiRequest: vi.fn(),
}));

describe('servicio de huéspedes alojados', () => {
  beforeEach(() => {
    vi.mocked(apiRequest).mockReset();
  });

  it('consulta el listado con filtros aplicados y página', async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      items: [],
      page: 2,
      pageSize: 10,
      totalItems: 0,
      totalPages: 0,
      message: null,
    });

    await listGuestStays({
      nationality: 'FOREIGN',
      presence: 'IN_HOTEL',
      dateFrom: '2026-10-01',
      dateTo: '2026-10-31',
      search: '  John  ',
      page: 2,
    });

    expect(apiRequest).toHaveBeenCalledWith(
      '/guest-stays?nationality=FOREIGN&presence=IN_HOTEL&dateFrom=2026-10-01&dateTo=2026-10-31&search=John&page=2',
    );
  });

  it('omite los filtros por defecto y consulta el detalle usando la ruta C2', async () => {
    await listGuestStays({
      nationality: 'ALL',
      presence: 'ALL',
      dateFrom: '',
      dateTo: '',
      search: '',
      page: 1,
    });

    expect(apiRequest).toHaveBeenCalledWith('/guest-stays');

    await getGuestStayDetail('RSV-3F9A1C7B', 'X99-A');

    expect(apiRequest).toHaveBeenLastCalledWith(
      '/reservations/RSV-3F9A1C7B/guests/X99-A',
    );
  });
});
