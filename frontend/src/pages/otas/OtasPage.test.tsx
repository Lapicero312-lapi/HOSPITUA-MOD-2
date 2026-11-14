import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../../routes.tsx';
import type { Ota, OtaList } from '../../services/otas.ts';
import { createQueryClient } from '../../services/query-client.ts';
import { signIn } from '../../services/session.ts';

/** La agencia del ejemplo de A3 del plan (su `15.00` llega como el número 15). El `id` es un UUID cualquiera. */
const BOOKING: Ota = {
  id: '5d1f8a3c-7b2e-4c9a-8e6d-0f4b2a7c9e13',
  name: 'Booking.com',
  commissionPercentage: 15,
  connectionStatus: 'CONNECTED',
  linkedAt: '2026-03-02T09:14:00-05:00',
  lastSyncAt: '2026-10-09T07:58:00-05:00',
  activeReservations: 3,
};

const REQUEST_NOT_PROCESSED_MESSAGE = 'No fue posible procesar la solicitud.';

const fetchMock = vi.fn<typeof fetch>();

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const otasResponse = (items: Ota[]) =>
  jsonResponse({ items, total: items.length } satisfies OtaList);

/** La aplicación completa (rutas y consultas), con la Recepcionista ya identificada. */
const renderAt = (path: string) => {
  signIn('Ana Pérez');
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
};

/** El texto de cada celda, fila por fila, sin la fila de los títulos. */
const tableRows = () =>
  within(screen.getByRole('table'))
    .getAllByRole('row')
    .slice(1)
    .map((row) =>
      within(row)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    );

/**
 * La pantalla "Agencias OTA" con `GET /api/otas` (A3 del plan de `register-ota-information-commission`)
 * simulado.
 */
describe('Pantalla "Agencias OTA"', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('muestra la agencia con su comisión, su conexión, su fecha de vinculación, su última sincronización y sus reservas activas', async () => {
    fetchMock.mockResolvedValue(otasResponse([BOOKING]));
    renderAt('/agencias');

    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Agencias OTA' }),
    ).toBeInTheDocument();
    expect(tableRows()).toEqual([
      [
        'Booking.com',
        '15 %',
        'Conectada',
        '02/03/2026',
        '09/10/2026 07:58',
        '3',
      ],
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/otas');
    expect(init?.method).toBe('GET');
  });

  it('las columnas son "Agencia", "Comisión", "Conexión", "Vinculada el", "Última sincronización" y "Reservas activas"', async () => {
    fetchMock.mockResolvedValue(otasResponse([BOOKING]));
    renderAt('/agencias');

    await screen.findByRole('table');
    expect(
      screen.getAllByRole('columnheader').map((header) => header.textContent),
    ).toEqual([
      'Agencia',
      'Comisión',
      'Conexión',
      'Vinculada el',
      'Última sincronización',
      'Reservas activas',
    ]);
  });

  it('es de solo lectura: no tiene botones ni campos (FR-008, "no crea ni edita agencias")', async () => {
    fetchMock.mockResolvedValue(otasResponse([BOOKING]));
    renderAt('/agencias');

    await screen.findByRole('table');
    // `main` es la pantalla: el botón "Salir" del encabezado no cuenta.
    expect(
      screen
        .getByRole('main')
        .querySelectorAll('button, input, select, textarea, [contenteditable]'),
    ).toHaveLength(0);
  });

  it('una agencia desconectada sigue en la lista, como "Desconectada", con sus demás datos (escenario 3)', async () => {
    fetchMock.mockResolvedValue(
      otasResponse([{ ...BOOKING, connectionStatus: 'DISCONNECTED' }]),
    );
    renderAt('/agencias');

    await screen.findByRole('table');
    expect(tableRows()).toEqual([
      [
        'Booking.com',
        '15 %',
        'Desconectada',
        '02/03/2026',
        '09/10/2026 07:58',
        '3',
      ],
    ]);
  });

  it.each([
    [15, '15 %'],
    [12.5, '12,5 %'],
    [14.95, '14,95 %'],
    [0, '0 %'],
    [null, 'Sin porcentaje'],
  ])('la comisión %s se muestra "%s"', async (commissionPercentage, text) => {
    fetchMock.mockResolvedValue(
      otasResponse([{ ...BOOKING, commissionPercentage }]),
    );
    renderAt('/agencias');

    await screen.findByRole('table');
    expect(tableRows()[0][1]).toBe(text);
  });

  it('las fechas y horas se muestran como llegan, en hora de Colombia, aunque el computador esté en otra zona horaria', async () => {
    vi.stubEnv('TZ', 'Asia/Tokyo');
    fetchMock.mockResolvedValue(
      otasResponse([
        {
          ...BOOKING,
          linkedAt: '2026-03-02T21:14:00-05:00',
          lastSyncAt: '2026-10-09T23:30:00-05:00',
        },
      ]),
    );
    renderAt('/agencias');

    await screen.findByRole('table');
    expect(tableRows()[0].slice(3, 5)).toEqual([
      '02/03/2026',
      '09/10/2026 23:30',
    ]);
  });

  it('mientras responde muestra "Cargando agencias…" y ninguna tabla', async () => {
    fetchMock.mockReturnValue(new Promise<Response>(() => undefined));
    renderAt('/agencias');

    expect(await screen.findByText('Cargando agencias…')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('si falla (400 REQUEST_NOT_PROCESSED) muestra su mensaje y ninguna tabla', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          errorCode: 'REQUEST_NOT_PROCESSED',
          message: REQUEST_NOT_PROCESSED_MESSAGE,
          timestamp: '2026-10-09T13:00:00.000Z',
          path: '/api/otas',
        },
        400,
      ),
    );
    renderAt('/agencias');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      REQUEST_NOT_PROCESSED_MESSAGE,
    );
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText('Cargando agencias…')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sin agencias (items: [] y total: 0) muestra "No hay agencias registradas." y ninguna tabla', async () => {
    fetchMock.mockResolvedValue(otasResponse([]));
    renderAt('/agencias');

    expect(
      await screen.findByText('No hay agencias registradas.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('la navegación lleva a la pantalla', async () => {
    fetchMock.mockResolvedValue(otasResponse([BOOKING]));
    const router = renderAt('/');

    await userEvent.click(
      within(screen.getByRole('navigation', { name: 'Principal' })).getByRole(
        'link',
        { name: 'Agencias OTA' },
      ),
    );

    expect(router.state.location.pathname).toBe('/agencias');
    expect(await screen.findByRole('table')).toBeInTheDocument();
  });

  it('el inicio lleva a la pantalla', async () => {
    fetchMock.mockResolvedValue(otasResponse([BOOKING]));
    const router = renderAt('/');

    await userEvent.click(
      within(screen.getByRole('main')).getByRole('link', {
        name: 'Agencias OTA',
      }),
    );

    expect(router.state.location.pathname).toBe('/agencias');
    expect(await screen.findByRole('table')).toBeInTheDocument();
  });
});
