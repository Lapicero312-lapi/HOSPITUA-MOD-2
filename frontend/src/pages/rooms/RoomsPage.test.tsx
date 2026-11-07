import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../../routes.tsx';
import { createQueryClient } from '../../services/query-client.ts';
import type { Room, RoomList } from '../../services/rooms.ts';
import { signIn } from '../../services/session.ts';

/** La 201 y la 202 del ejemplo de C1 del plan. Los `id` son UUID cualesquiera. */
const ROOM_201: Room = {
  id: '0b8a4c2e-5f1d-4e7a-9c3b-2d6f8e1a7b40',
  roomNumber: '201',
  categoryRoom: 'DOBLE',
  maxCapacity: 2,
  maintenance: {
    status: 'SCHEDULED',
    maintenanceStart: '2026-10-20',
    maintenanceEnd: '2026-10-22',
  },
};
const ROOM_202: Room = {
  id: '7e2d9f14-3a6b-4c8d-b1e5-9f0a2c4d6e81',
  roomNumber: '202',
  categoryRoom: 'DOBLE',
  maxCapacity: 3,
  maintenance: { status: 'NONE', maintenanceStart: null, maintenanceEnd: null },
};
/** La 101 de `SUITE_JUNIOR` de la T012, con su calendario sin consultar. */
const ROOM_101: Room = {
  id: '3c5e7a91-2b4d-4f6a-8c0e-1d3f5b7a9c20',
  roomNumber: '101',
  categoryRoom: 'SUITE_JUNIOR',
  maxCapacity: 2,
  maintenance: {
    status: 'UNAVAILABLE',
    maintenanceStart: null,
    maintenanceEnd: null,
  },
};

const INVENTORY_UNAVAILABLE_MESSAGE =
  'No se pudo consultar el inventario de habitaciones en este momento. Intente de nuevo.';

const fetchMock = vi.fn<typeof fetch>();

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const roomsResponse = (items: Room[]) =>
  jsonResponse({ items, total: items.length } satisfies RoomList);

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
 * La pantalla "Habitaciones" (FR-006) con `GET /api/rooms` simulado: los datos de la fila
 * "Datos de las pruebas (T014)" del plan.
 */
describe('Pantalla "Habitaciones"', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  it('muestra una fila por habitación, en el orden en que llegan, con su número, categoría, capacidad y mantenimiento próximo', async () => {
    fetchMock.mockResolvedValue(roomsResponse([ROOM_201, ROOM_202, ROOM_101]));
    renderAt('/habitaciones');

    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Habitaciones' }),
    ).toBeInTheDocument();
    expect(tableRows()).toEqual([
      ['Hab. 201', 'DOBLE', '2 personas', '20/10/2026 → 22/10/2026'],
      ['Hab. 202', 'DOBLE', '3 personas', 'Sin mantenimiento próximo'],
      [
        'Hab. 101',
        'SUITE_JUNIOR',
        '2 personas',
        'No se pudo consultar el mantenimiento',
      ],
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/rooms');
    expect(init?.method).toBe('GET');
  });

  it('las columnas son "N.º", "Categoría", "Capacidad" y "Mantenimiento próximo", sin ninguna de estado', async () => {
    fetchMock.mockResolvedValue(roomsResponse([ROOM_201, ROOM_202, ROOM_101]));
    renderAt('/habitaciones');

    await screen.findByRole('table');
    expect(
      screen.getAllByRole('columnheader').map((header) => header.textContent),
    ).toEqual(['N.º', 'Categoría', 'Capacidad', 'Mantenimiento próximo']);
  });

  it('una habitación de capacidad 1 se muestra "1 persona"', async () => {
    fetchMock.mockResolvedValue(
      roomsResponse([{ ...ROOM_201, maxCapacity: 1 }]),
    );
    renderAt('/habitaciones');

    await screen.findByRole('table');
    expect(tableRows()).toEqual([
      ['Hab. 201', 'DOBLE', '1 persona', '20/10/2026 → 22/10/2026'],
    ]);
  });

  it('mientras responde muestra "Cargando habitaciones…" y ninguna tabla', async () => {
    fetchMock.mockReturnValue(new Promise<Response>(() => undefined));
    renderAt('/habitaciones');

    expect(
      await screen.findByText('Cargando habitaciones…'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('si falla el inventario (400 INVENTORY_UNAVAILABLE) muestra su mensaje y ninguna tabla', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          errorCode: 'INVENTORY_UNAVAILABLE',
          message: INVENTORY_UNAVAILABLE_MESSAGE,
          timestamp: '2026-10-11T15:00:00.000Z',
          path: '/api/rooms',
        },
        400,
      ),
    );
    renderAt('/habitaciones');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      INVENTORY_UNAVAILABLE_MESSAGE,
    );
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(
      screen.queryByText('Cargando habitaciones…'),
    ).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sin habitaciones (items: [] y total: 0) muestra "No hay habitaciones registradas." y ninguna tabla', async () => {
    fetchMock.mockResolvedValue(roomsResponse([]));
    renderAt('/habitaciones');

    expect(
      await screen.findByText('No hay habitaciones registradas.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('la navegación lleva a la pantalla', async () => {
    fetchMock.mockResolvedValue(roomsResponse([ROOM_201]));
    const router = renderAt('/');

    await userEvent.click(
      within(screen.getByRole('navigation', { name: 'Principal' })).getByRole(
        'link',
        { name: 'Habitaciones' },
      ),
    );

    expect(router.state.location.pathname).toBe('/habitaciones');
    expect(await screen.findByRole('table')).toBeInTheDocument();
  });

  it('el inicio lleva a la pantalla', async () => {
    fetchMock.mockResolvedValue(roomsResponse([ROOM_201]));
    const router = renderAt('/');

    await userEvent.click(
      within(screen.getByRole('main')).getByRole('link', {
        name: 'Habitaciones',
      }),
    );

    expect(router.state.location.pathname).toBe('/habitaciones');
    expect(await screen.findByRole('table')).toBeInTheDocument();
  });
});
