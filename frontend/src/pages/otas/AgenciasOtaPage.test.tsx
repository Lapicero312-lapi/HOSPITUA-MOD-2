import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgenciasOtaPage } from './AgenciasOtaPage.tsx';

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
          lastSyncAt: '2026-10-09T07:58:00-05:00',
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
});
