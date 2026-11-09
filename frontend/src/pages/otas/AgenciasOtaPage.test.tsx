import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgenciasOtaPage } from './AgenciasOtaPage.tsx';
import { ApiError } from '../../services/api-client.ts';

vi.mock('../../services/otas.ts', () => ({
  listOtas: vi.fn(),
}));

import { listOtas } from '../../services/otas.ts';

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AgenciasOtaPage />
    </QueryClientProvider>,
  );
}

describe('AgenciasOtaPage', () => {
  beforeEach(() => {
    vi.mocked(listOtas).mockReset();
  });

  it('muestra las agencias en modo solo lectura', async () => {
    vi.mocked(listOtas).mockResolvedValue({
      items: [
        {
          id: 'ota-1',
          name: 'Booking.com',
          commissionPercentage: 15,
          connectionStatus: 'CONNECTED',
          linkedAt: '2026-03-02T09:14:00-05:00',
          lastSyncAt: '2026-03-02T02:30:00Z',
          activeReservations: 3,
        },
      ],
      total: 1,
    });

    renderPage();

    expect(await screen.findByText('Booking.com')).toBeInTheDocument();
    expect(screen.getByText(/15,00 %/)).toBeInTheDocument();
    expect(screen.getByText('Conectada')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    const row = screen.getByRole('row', { name: /Booking\.com/ });
    expect(within(row).getByText('02/03/2026 09:14')).toBeInTheDocument();
    expect(within(row).getByText('01/03/2026 21:30')).toBeInTheDocument();
    expect(screen.getByRole('table').querySelector('caption')).toHaveClass(
      'visually-hidden',
    );
  });

  it('muestra que una agencia aún no tiene porcentaje', async () => {
    vi.mocked(listOtas).mockResolvedValue({
      items: [
        {
          id: 'ota-2',
          name: 'Expedia',
          commissionPercentage: null,
          connectionStatus: 'DISCONNECTED',
          linkedAt: '2026-03-02T09:14:00-05:00',
          lastSyncAt: '2026-10-09T07:58:00-05:00',
          activeReservations: 0,
        },
      ],
      total: 1,
    });

    renderPage();

    expect(await screen.findByText('Sin registrar')).toBeInTheDocument();
    expect(screen.getByText('Desconectada')).toBeInTheDocument();
  });

  it('muestra el estado vacío sin inventar datos', async () => {
    vi.mocked(listOtas).mockResolvedValue({ items: [], total: 0 });

    renderPage();

    expect(
      await screen.findByText('No hay agencias OTA registradas.'),
    ).toBeInTheDocument();
  });

  it('muestra el mensaje de error del API dentro de la pantalla', async () => {
    vi.mocked(listOtas).mockRejectedValue(
      new ApiError(
        'OTAS_UNAVAILABLE',
        'No se pudieron consultar las agencias.',
        400,
      ),
    );

    renderPage();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('No se pudieron consultar las agencias.');
    expect(alert).toHaveClass('error-message');
    expect(alert.closest('.ota-page')).not.toBeNull();
  });
});
