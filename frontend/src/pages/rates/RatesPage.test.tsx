import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../../routes.tsx';
import { createQueryClient } from '../../services/query-client.ts';
import type { ReferenceRate, ReferenceRates } from '../../services/rates.ts';
import { signIn } from '../../services/session.ts';

const NOTE = 'Referencia ilustrativa. La tarifa real se obtiene al cotizar.';
const REQUEST_NOT_PROCESSED_MESSAGE = 'No fue posible procesar la solicitud.';

/** La fila del ejemplo de C1 del plan: `DOBLE` con un ajuste del 15 %. */
const DOBLE: ReferenceRate = {
  categoryRoom: 'DOBLE',
  baseRate: { amount: '220000.00', currency: 'COP' },
  seasonAdjustmentPercentage: '15.00',
  effectiveRate: { amount: '253000.00', currency: 'COP' },
};
/** La otra categoría de la configuración del ejemplo de C1. */
const SUITE: ReferenceRate = {
  categoryRoom: 'SUITE',
  baseRate: { amount: '480000.00', currency: 'COP' },
  seasonAdjustmentPercentage: '15.00',
  effectiveRate: { amount: '552000.00', currency: 'COP' },
};

const fetchMock = vi.fn<typeof fetch>();

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const ratesResponse = (items: ReferenceRate[]) =>
  jsonResponse({ items, note: NOTE } satisfies ReferenceRates);

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
 * La pantalla "Tarifas" (spec de `calculate-dynamic-rate`, FR-009) con `GET /api/rates/reference` (C1 del
 * plan) simulado.
 */
describe('Pantalla "Tarifas"', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  it('muestra el ejemplo de C1: la categoría, la tarifa base, el ajuste de temporada y la tarifa efectiva por noche, con la nota', async () => {
    fetchMock.mockResolvedValue(ratesResponse([DOBLE]));
    renderAt('/tarifas');

    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Tarifas' }),
    ).toBeInTheDocument();
    expect(tableRows()).toEqual([
      ['DOBLE', '220.000,00 COP', '+15 %', '253.000,00 COP'],
    ]);
    expect(screen.getByText(NOTE)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/rates/reference');
    expect(init?.method).toBe('GET');
  });

  it('las columnas son "Categoría", "Tarifa base", "Ajuste de temporada" y "Tarifa efectiva / noche": sin la capacidad', async () => {
    fetchMock.mockResolvedValue(ratesResponse([DOBLE]));
    renderAt('/tarifas');

    await screen.findByRole('table');
    expect(
      screen.getAllByRole('columnheader').map((header) => header.textContent),
    ).toEqual([
      'Categoría',
      'Tarifa base',
      'Ajuste de temporada',
      'Tarifa efectiva / noche',
    ]);
    expect(screen.queryByText(/capacidad|personas/i)).not.toBeInTheDocument();
  });

  it('muestra las categorías en el orden en que llegan', async () => {
    fetchMock.mockResolvedValue(ratesResponse([SUITE, DOBLE]));
    renderAt('/tarifas');

    await screen.findByRole('table');
    expect(tableRows().map(([category]) => category)).toEqual([
      'SUITE',
      'DOBLE',
    ]);
  });

  it.each([
    ['un ajuste negativo con decimales', '-12.50', '-12,5 %'],
    ['un ajuste con dos decimales', '7.25', '+7,25 %'],
    ['sin ajuste', '0.00', '0 %'],
    ['un ajuste de 100', '100.00', '+100 %'],
  ])(
    'el ajuste de temporada: %s (%s) se muestra como %s',
    async (_case, percentage, shown) => {
      fetchMock.mockResolvedValue(
        ratesResponse([{ ...DOBLE, seasonAdjustmentPercentage: percentage }]),
      );
      renderAt('/tarifas');

      await screen.findByRole('table');
      expect(tableRows()[0][2]).toBe(shown);
    },
  );

  it('los importes con puntos de miles y coma decimal, en su moneda, tal como llegan', async () => {
    fetchMock.mockResolvedValue(
      ratesResponse([
        {
          categoryRoom: 'SUITE_JUNIOR',
          baseRate: { amount: '95.50', currency: 'USD' },
          seasonAdjustmentPercentage: '15.00',
          effectiveRate: { amount: '1250000.05', currency: 'USD' },
        },
      ]),
    );
    renderAt('/tarifas');

    await screen.findByRole('table');
    expect(tableRows()).toEqual([
      ['SUITE_JUNIOR', '95,50 USD', '+15 %', '1.250.000,05 USD'],
    ]);
  });

  it('la tarifa efectiva es la que calcula el backend: la pantalla no hace cuentas', async () => {
    // Con un 15 %, la tarifa efectiva de 220 000 sería 253 000; se muestra la que llega.
    fetchMock.mockResolvedValue(
      ratesResponse([
        { ...DOBLE, effectiveRate: { amount: '250000.00', currency: 'COP' } },
      ]),
    );
    renderAt('/tarifas');

    await screen.findByRole('table');
    expect(tableRows()[0][3]).toBe('250.000,00 COP');
  });

  it('es de solo lectura: no tiene botones ni campos', async () => {
    fetchMock.mockResolvedValue(ratesResponse([DOBLE, SUITE]));
    renderAt('/tarifas');

    await screen.findByRole('table');
    // `main` es la pantalla: el botón "Salir" del encabezado no cuenta.
    expect(
      screen
        .getByRole('main')
        .querySelectorAll('button, input, select, textarea, [contenteditable]'),
    ).toHaveLength(0);
  });

  it('sin tarifas configuradas (items: []) muestra que no hay, la nota y ninguna tabla', async () => {
    fetchMock.mockResolvedValue(ratesResponse([]));
    renderAt('/tarifas');

    expect(
      await screen.findByText('No hay tarifas de referencia configuradas.'),
    ).toBeInTheDocument();
    expect(screen.getByText(NOTE)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('mientras responde muestra "Cargando tarifas…" y ninguna tabla', async () => {
    fetchMock.mockReturnValue(new Promise<Response>(() => undefined));
    renderAt('/tarifas');

    expect(await screen.findByText('Cargando tarifas…')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('si falla (400 REQUEST_NOT_PROCESSED) muestra su mensaje, ninguna tabla y ninguna nota', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          errorCode: 'REQUEST_NOT_PROCESSED',
          message: REQUEST_NOT_PROCESSED_MESSAGE,
          timestamp: '2026-10-11T15:00:00.000Z',
          path: '/api/rates/reference',
        },
        400,
      ),
    );
    renderAt('/tarifas');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      REQUEST_NOT_PROCESSED_MESSAGE,
    );
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText(NOTE)).not.toBeInTheDocument();
    expect(screen.queryByText('Cargando tarifas…')).not.toBeInTheDocument();
  });

  it('la navegación lleva a la pantalla, entre "Habitaciones" y "Agencias OTA" como en el wireframe', async () => {
    fetchMock.mockResolvedValue(ratesResponse([DOBLE]));
    const router = renderAt('/');
    const navigation = screen.getByRole('navigation', { name: 'Principal' });

    expect(
      within(navigation)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Inicio', 'Habitaciones', 'Tarifas', 'Agencias OTA']);
    await userEvent.click(
      within(navigation).getByRole('link', { name: 'Tarifas' }),
    );

    expect(router.state.location.pathname).toBe('/tarifas');
    expect(await screen.findByRole('table')).toBeInTheDocument();
  });

  it('el inicio tiene el acceso a la pantalla', async () => {
    fetchMock.mockResolvedValue(ratesResponse([DOBLE]));
    const router = renderAt('/');

    await userEvent.click(
      within(screen.getByRole('main')).getByRole('link', { name: 'Tarifas' }),
    );

    expect(router.state.location.pathname).toBe('/tarifas');
    expect(await screen.findByRole('table')).toBeInTheDocument();
  });
});
