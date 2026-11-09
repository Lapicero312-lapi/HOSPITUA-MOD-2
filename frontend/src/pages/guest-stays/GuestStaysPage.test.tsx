import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GuestStaysPage } from './GuestStaysPage.tsx';

vi.mock('../../services/guest-stays.ts', () => ({
  listGuestStays: vi.fn(),
  getGuestStayDetail: vi.fn(),
}));

import {
  getGuestStayDetail,
  listGuestStays,
} from '../../services/guest-stays.ts';
import { ApiError } from '../../services/api-client.ts';

const stay = {
  reservationRef: 'RSV-3F9A1C7B',
  guest: {
    firstName: 'John',
    lastName: 'Smith',
    documentType: 'PAS',
    documentNumber: 'X99',
    nationality: 'Estados Unidos',
    isForeign: true,
  },
  entryDate: '2026-10-09',
  exitDate: null,
  inHotel: true,
};

const page = {
  items: [stay],
  page: 1,
  pageSize: 10,
  totalItems: 21,
  totalPages: 3,
  message: null,
};

const detail = {
  reservationRef: stay.reservationRef,
  reservationLink: '/api/reservations/RSV-3F9A1C7B',
  guest: {
    ...stay.guest,
    birthDate: '1990-05-12',
    originPlace: 'Miami, Estados Unidos',
    destinationPlace: null,
  },
  movements: [{ movementType: 'ENTRY' as const, movementDate: '2026-10-09' }],
};

function renderPage(path = '/guest-stays') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createMemoryRouter(
    [
      {
        path: '/guest-stays',
        element: <GuestStaysPage />,
      },
    ],
    { initialEntries: [path] },
  );
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('GuestStaysPage', () => {
  beforeEach(() => {
    vi.mocked(listGuestStays).mockReset();
    vi.mocked(getGuestStayDetail).mockReset();
  });

  it('muestra la página de huéspedes alojados en modo de solo lectura', async () => {
    vi.mocked(listGuestStays).mockResolvedValue(page);
    renderPage();

    expect(await screen.findByText('John Smith')).toBeInTheDocument();
    expect(screen.getByText('PAS X99')).toBeInTheDocument();
    expect(screen.getByText('Estados Unidos')).toBeInTheDocument();
    expect(screen.getByText('Extranjero')).toBeInTheDocument();
    expect(
      within(screen.getByRole('row', { name: /John Smith/ })).getByText(
        'En el hotel',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('09/10/2026')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ver detalle' })).toBeEnabled();
    expect(
      screen.queryByRole('button', { name: /editar|guardar/i }),
    ).toBeNull();
  });

  it('aplica los filtros y permite avanzar a otra página', async () => {
    const user = userEvent.setup();
    vi.mocked(listGuestStays).mockResolvedValue(page);
    renderPage();

    await screen.findByText('John Smith');
    await user.selectOptions(screen.getByLabelText('Nacionalidad'), 'FOREIGN');
    await user.selectOptions(screen.getByLabelText('Situación'), 'IN_HOTEL');
    await user.type(screen.getByLabelText('Buscar'), 'John');
    fireEvent.change(screen.getByLabelText('Desde'), {
      target: { value: '2026-10-01' },
    });
    fireEvent.change(screen.getByLabelText('Hasta'), {
      target: { value: '2026-10-31' },
    });
    await user.click(screen.getByRole('button', { name: 'Aplicar filtros' }));

    expect(listGuestStays).toHaveBeenLastCalledWith({
      nationality: 'FOREIGN',
      presence: 'IN_HOTEL',
      dateFrom: '2026-10-01',
      dateTo: '2026-10-31',
      search: 'John',
      page: 1,
    });

    await user.click(screen.getByRole('button', { name: 'Siguiente →' }));
    expect(listGuestStays).toHaveBeenLastCalledWith({
      nationality: 'FOREIGN',
      presence: 'IN_HOTEL',
      dateFrom: '2026-10-01',
      dateTo: '2026-10-31',
      search: 'John',
      page: 2,
    });
  });

  it('muestra el detalle completo del huésped con campos vacíos como raya', async () => {
    const user = userEvent.setup();
    vi.mocked(listGuestStays).mockResolvedValue(page);
    vi.mocked(getGuestStayDetail).mockResolvedValue(detail);
    renderPage();

    await user.click(
      await screen.findByRole('button', { name: 'Ver detalle' }),
    );

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('John Smith')).toBeInTheDocument();
    expect(within(dialog).getByText('PAS X99')).toBeInTheDocument();
    expect(
      within(dialog).getByText('Miami, Estados Unidos'),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('12/05/1990')).toBeInTheDocument();
    expect(within(dialog).getByText('09/10/2026')).toBeInTheDocument();
    expect(within(dialog).getByText('—')).toBeInTheDocument();
    expect(within(dialog).getByText('Entrada')).toBeInTheDocument();
    expect(
      within(dialog).getByRole('link', { name: 'Ver reserva' }),
    ).toHaveAttribute('href', '/reservations/RSV-3F9A1C7B');
  });

  it('muestra una raya por cada dato vacío del detalle', async () => {
    const user = userEvent.setup();
    vi.mocked(listGuestStays).mockResolvedValue(page);
    vi.mocked(getGuestStayDetail).mockResolvedValue({
      ...detail,
      guest: {
        ...detail.guest,
        documentType: '',
        firstName: null,
        lastName: 'Pérez',
        birthDate: null,
        nationality: '',
        originPlace: null,
        destinationPlace: '',
      },
    });
    renderPage();

    await user.click(
      await screen.findByRole('button', { name: 'Ver detalle' }),
    );

    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByRole('heading', { name: '— Pérez' }),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('— X99')).toBeInTheDocument();
    expect(within(dialog).getAllByText('—')).toHaveLength(4);
    expect(within(dialog).queryByText(/null/)).toBeNull();
  });

  it('muestra el mensaje del API cuando los filtros son inválidos', async () => {
    const user = userEvent.setup();
    vi.mocked(listGuestStays)
      .mockResolvedValueOnce(page)
      .mockRejectedValueOnce(
        new ApiError(
          'INVALID_DATE_RANGE',
          'La fecha inicial no puede ser posterior a la fecha final.',
          400,
        ),
      );
    renderPage();

    await screen.findByText('John Smith');
    fireEvent.change(screen.getByLabelText('Desde'), {
      target: { value: '2026-10-31' },
    });
    fireEvent.change(screen.getByLabelText('Hasta'), {
      target: { value: '2026-10-01' },
    });
    await user.click(screen.getByRole('button', { name: 'Aplicar filtros' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'La fecha inicial no puede ser posterior a la fecha final.',
    );
    expect(screen.getByRole('alert')).toHaveClass('error-message');
    expect(listGuestStays).toHaveBeenLastCalledWith({
      nationality: 'ALL',
      presence: 'ALL',
      dateFrom: '2026-10-31',
      dateTo: '2026-10-01',
      search: '',
      page: 1,
    });
  });

  it('muestra el mensaje del API cuando los filtros no encuentran huéspedes', async () => {
    vi.mocked(listGuestStays).mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 10,
      totalItems: 0,
      totalPages: 0,
      message: 'No hay huéspedes que coincidan con los filtros.',
    });
    renderPage();

    expect(
      await screen.findByText(
        'No hay huéspedes que coincidan con los filtros.',
      ),
    ).toBeInTheDocument();
  });
});
