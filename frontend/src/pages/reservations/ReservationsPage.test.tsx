import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../../routes.tsx';
import { createQueryClient } from '../../services/query-client.ts';
import type {
  DaySummary,
  ReservationList,
  ReservationListItem,
} from '../../services/reservations.ts';
import { signIn } from '../../services/session.ts';

/** La fila del ejemplo de C1 del plan de `check-view-reservation`. */
const DIRECT: ReservationListItem = {
  reservationRef: 'RSV-3F9A1C7B',
  externalConfirmationCode: null,
  guest: { fullName: 'Valentina Ospina', documentNumber: '1144093552' },
  rooms: [{ roomNumber: '204', categoryRoom: 'DOBLE' }],
  source: 'DIRECT',
  otaName: null,
  startDate: '2026-10-23',
  endDate: '2026-10-25',
  status: 'ACTIVE',
  migrationStatus: 'AWAITING_CHECK_IN',
  conflict: null,
  actions: { canModify: true, canCancel: true, canAssignRoom: false },
};

/** Una reserva de Booking en conflicto, con una habitación sin asignar (FR-002a). */
const BOOKING_IN_CONFLICT: ReservationListItem = {
  reservationRef: 'RSV-0A1B2C3D',
  externalConfirmationCode: 'BK-99812',
  guest: { fullName: 'Ana Pérez', documentNumber: null },
  rooms: [
    { roomNumber: '301', categoryRoom: 'SUITE' },
    { roomNumber: null, categoryRoom: 'SUITE' },
  ],
  source: 'OTA',
  otaName: 'Booking.com',
  startDate: '2026-11-10',
  endDate: '2026-11-12',
  status: 'ACTIVE',
  migrationStatus: 'AWAITING_CHECK_IN',
  conflict: {
    reason: 'NO_ROOM_AVAILABLE',
    detectedAt: '2026-10-08T09:00:00-05:00',
  },
  actions: { canModify: false, canCancel: false, canAssignRoom: true },
};

/** El resumen del ejemplo de C2. */
const SUMMARY: DaySummary = {
  operationalDate: '2026-10-09',
  expectedArrivals: 2,
  expectedDepartures: 0,
};

const BOOKING_OTA_ID = '5d1f8a3c-7b2e-4c9a-8e6d-0f4b2a7c9e13';

const NO_RESULTS_MESSAGE =
  'No se encontraron reservas con los filtros aplicados.';

const listOf = (
  items: ReservationListItem[],
  changes: Partial<ReservationList> = {},
): ReservationList => ({
  items,
  page: 1,
  pageSize: 10,
  totalItems: items.length,
  totalPages: items.length === 0 ? 0 : 1,
  message: items.length === 0 ? NO_RESULTS_MESSAGE : null,
  ...changes,
});

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const errorResponse = (errorCode: string, message: string) =>
  jsonResponse(
    {
      errorCode,
      message,
      timestamp: '2026-10-09T13:00:00.000Z',
      path: '/api/reservations',
    },
    400,
  );

const fetchMock = vi.fn<typeof fetch>();

/** Lo que responde cada ruta; el listado se puede cambiar en cada prueba. */
let listAnswer: (query: URLSearchParams) => Response;
let summaryAnswer: () => Response | Promise<Response>;

/** Las consultas al listado, en orden, como un objeto por consulta. */
const listQueries = () =>
  fetchMock.mock.calls
    .map(([url]) => String(url))
    .filter((url) => /^\/api\/reservations(\?|$)/.test(url))
    .map((url) =>
      Object.fromEntries(new URLSearchParams(url.split('?')[1] ?? '')),
    );

const lastListQuery = () => listQueries().at(-1);

/** La aplicación completa (rutas y consultas), con la Recepcionista ya identificada. */
const renderAt = (path: string) => {
  signIn('Laura Méndez');
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
 * La pantalla "Consultar reservas" con `GET /api/reservations` (C1) y `GET /api/reservations/day-summary`
 * (C2) del plan de `check-view-reservation` simulados.
 */
describe('Pantalla "Consultar reservas"', () => {
  beforeEach(() => {
    listAnswer = () => jsonResponse(listOf([DIRECT]));
    summaryAnswer = () => jsonResponse(SUMMARY);
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url === '/api/reservations/day-summary') {
        return Promise.resolve(summaryAnswer());
      }
      if (url === '/api/otas') {
        return Promise.resolve(
          jsonResponse({
            items: [
              {
                id: BOOKING_OTA_ID,
                name: 'Booking.com',
                commissionPercentage: 15,
                connectionStatus: 'CONNECTED',
                linkedAt: '2026-03-02T09:14:00-05:00',
                lastSyncAt: '2026-10-09T07:58:00-05:00',
                activeReservations: 3,
              },
            ],
            total: 1,
          }),
        );
      }
      return Promise.resolve(
        listAnswer(new URLSearchParams(url.split('?')[1] ?? '')),
      );
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  describe('el listado (FR-005)', () => {
    it('muestra la fila del ejemplo de C1 con sus ocho columnas', async () => {
      renderAt('/reservas');

      expect(await screen.findByRole('table')).toBeInTheDocument();
      expect(
        screen.getByRole('heading', { name: 'Consultar reservas' }),
      ).toBeInTheDocument();
      expect(
        screen.getAllByRole('columnheader').map((header) => header.textContent),
      ).toEqual([
        'Ref. reserva',
        'Huésped',
        'Habitaciones',
        'Canal',
        'Fechas (in → out)',
        'Estado',
        'Migración',
        'Acciones',
      ]);
      expect(tableRows()).toEqual([
        [
          'RSV-3F9A1C7B',
          'Valentina Ospina1144093552',
          '204 · DOBLE',
          'Directo',
          '23/10/2026 → 25/10/2026',
          'Activa',
          'Pendiente de Check-In',
          'Ver detalleModificarCancelar',
        ],
      ]);
    });

    it('sin filtros pide la primera página en orden descendente y nada más', async () => {
      renderAt('/reservas');

      await screen.findByRole('table');
      expect(listQueries()).toEqual([{ order: 'desc', page: '1' }]);
    });

    it('una reserva de Booking muestra su código, su agencia, todas sus habitaciones en una sola fila y "Sin asignar"', async () => {
      listAnswer = () => jsonResponse(listOf([BOOKING_IN_CONFLICT]));
      renderAt('/reservas');

      await screen.findByRole('table');
      const [row] = tableRows();
      expect(row.slice(0, 4)).toEqual([
        'RSV-0A1B2C3DBK-99812',
        'Ana Pérez',
        '301 · SUITESin asignar · SUITE',
        'OTABooking.com',
      ]);
    });

    it('una reserva en conflicto lleva la marca "En conflicto" y la acción "Asignar habitación"', async () => {
      listAnswer = () => jsonResponse(listOf([BOOKING_IN_CONFLICT]));
      renderAt('/reservas');

      await screen.findByRole('table');
      expect(screen.getByText('En conflicto')).toBeInTheDocument();
      expect(
        screen.getByRole('link', {
          name: 'Asignar habitación a RSV-0A1B2C3D',
        }),
      ).toHaveAttribute('href', '/reservas/RSV-0A1B2C3D/asignar-habitacion');
    });

    it('sin conflicto no hay marca ni "Asignar habitación"', async () => {
      renderAt('/reservas');

      await screen.findByRole('table');
      expect(screen.queryByText('En conflicto')).not.toBeInTheDocument();
      expect(
        screen.queryByRole('link', { name: /Asignar habitación/ }),
      ).not.toBeInTheDocument();
    });

    it.each([
      ['ACTIVE', 'Activa'],
      ['PENDING', 'Pendiente'],
      ['IN_PROGRESS', 'En curso'],
      ['COMPLETED', 'Completada'],
      ['CANCELLED', 'Cancelada'],
      ['NO_SHOW', 'No se presentó'],
    ] as const)('el estado %s se muestra "%s"', async (status, text) => {
      listAnswer = () => jsonResponse(listOf([{ ...DIRECT, status }]));
      renderAt('/reservas');

      await screen.findByRole('table');
      expect(tableRows()[0][5]).toBe(text);
    });

    it.each([
      ['AWAITING_CHECK_IN', 'Pendiente de Check-In'],
      ['COMPLETE', 'Completo'],
      ['NOT_REQUIRED', 'Sin extranjeros'],
      ['NO_CHECK_IN', 'Sin Check-In'],
    ] as const)(
      'el estado migratorio %s se muestra "%s" (FR-005b)',
      async (migrationStatus, text) => {
        listAnswer = () =>
          jsonResponse(listOf([{ ...DIRECT, migrationStatus }]));
        renderAt('/reservas');

        await screen.findByRole('table');
        expect(tableRows()[0][6]).toBe(text);
      },
    );
  });

  describe('las acciones de cada fila (FR-005)', () => {
    it('una reserva que se puede modificar y cancelar tiene los tres enlaces', async () => {
      renderAt('/reservas');

      await screen.findByRole('table');
      expect(
        screen.getByRole('link', { name: 'Ver detalle de RSV-3F9A1C7B' }),
      ).toHaveAttribute('href', '/reservas/RSV-3F9A1C7B');
      expect(
        screen.getByRole('link', { name: 'Modificar RSV-3F9A1C7B' }),
      ).toHaveAttribute('href', '/reservas/RSV-3F9A1C7B/modificar');
      expect(
        screen.getByRole('link', { name: 'Cancelar RSV-3F9A1C7B' }),
      ).toHaveAttribute('href', '/reservas/RSV-3F9A1C7B/cancelar');
    });

    it('si el backend dice que no se puede modificar ni cancelar, esas acciones quedan deshabilitadas y sin enlace; "Ver detalle" sigue', async () => {
      listAnswer = () =>
        jsonResponse(
          listOf([
            {
              ...DIRECT,
              status: 'COMPLETED',
              actions: {
                canModify: false,
                canCancel: false,
                canAssignRoom: false,
              },
            },
          ]),
        );
      renderAt('/reservas');

      await screen.findByRole('table');
      for (const name of ['Modificar RSV-3F9A1C7B', 'Cancelar RSV-3F9A1C7B']) {
        const action = screen.getByRole('link', { name });
        expect(action).toHaveAttribute('aria-disabled', 'true');
        expect(action).not.toHaveAttribute('href');
      }
      expect(
        screen.getByRole('link', { name: 'Ver detalle de RSV-3F9A1C7B' }),
      ).toHaveAttribute('href', '/reservas/RSV-3F9A1C7B');
    });
  });

  describe('el resumen del día (FR-005a)', () => {
    it('muestra las llegadas y las salidas esperadas hoy y el día operativo', async () => {
      renderAt('/reservas');

      const summary = await screen.findByLabelText(
        'Resumen del día 09/10/2026',
      );
      expect(summary).toHaveTextContent('Llegadas esperadas hoy2');
      expect(summary).toHaveTextContent('Salidas esperadas hoy0');
      expect(summary).toHaveTextContent('Día operativo09/10/2026');
    });

    it('si el resumen falla, muestra su mensaje y el listado sigue', async () => {
      summaryAnswer = () =>
        errorResponse(
          'REQUEST_NOT_PROCESSED',
          'No fue posible procesar la solicitud.',
        );
      renderAt('/reservas');

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'No fue posible procesar la solicitud.',
      );
      expect(await screen.findByRole('table')).toBeInTheDocument();
    });
  });

  describe('los filtros', () => {
    it('el estado se aplica al elegirlo y vuelve a la página 1', async () => {
      const user = userEvent.setup();
      const router = renderAt('/reservas?page=3');
      await screen.findByRole('table');

      await user.selectOptions(screen.getByLabelText('Estado'), 'Pendiente');

      await waitFor(() =>
        expect(lastListQuery()).toEqual({
          status: 'PENDING',
          order: 'desc',
          page: '1',
        }),
      );
      expect(router.state.location.search).toBe('?status=PENDING');
    });

    it('las opciones del estado son "Todos" y los seis estados', async () => {
      renderAt('/reservas');
      await screen.findByRole('table');

      expect(
        within(screen.getByLabelText('Estado'))
          .getAllByRole('option')
          .map((option) => option.textContent),
      ).toEqual([
        'Todos',
        'Activa',
        'Pendiente',
        'En curso',
        'Completada',
        'Cancelada',
        'No se presentó',
      ]);
    });

    it('la agencia solo se habilita con el canal OTA, y entonces trae las agencias', async () => {
      const user = userEvent.setup();
      renderAt('/reservas');
      await screen.findByRole('table');
      expect(screen.getByLabelText('Agencia')).toBeDisabled();

      await user.selectOptions(screen.getByLabelText('Canal'), 'OTA');

      expect(screen.getByLabelText('Agencia')).toBeEnabled();
      expect(
        await screen.findByRole('option', { name: 'Booking.com' }),
      ).toBeInTheDocument();
      await waitFor(() =>
        expect(lastListQuery()).toEqual({
          source: 'OTA',
          order: 'desc',
          page: '1',
        }),
      );
    });

    it('con el canal OTA y una agencia envía los dos; al volver a "Todos" quita la agencia', async () => {
      const user = userEvent.setup();
      renderAt('/reservas?source=OTA');
      await screen.findByRole('option', { name: 'Booking.com' });

      await user.selectOptions(screen.getByLabelText('Agencia'), 'Booking.com');
      await waitFor(() =>
        expect(lastListQuery()).toEqual({
          source: 'OTA',
          otaId: BOOKING_OTA_ID,
          order: 'desc',
          page: '1',
        }),
      );

      await user.selectOptions(screen.getByLabelText('Canal'), 'Todos');
      await waitFor(() =>
        expect(lastListQuery()).toEqual({ order: 'desc', page: '1' }),
      );
    });

    it('una agencia en la dirección sin el canal OTA no se envía: el backend la rechazaría (AGENCY_REQUIRES_OTA_CHANNEL)', async () => {
      renderAt(`/reservas?otaId=${BOOKING_OTA_ID}`);

      await screen.findByRole('table');
      expect(listQueries()).toEqual([{ order: 'desc', page: '1' }]);
    });

    it('"Solo en conflicto" envía inConflict=true (FR-002a)', async () => {
      const user = userEvent.setup();
      renderAt('/reservas');
      await screen.findByRole('table');

      await user.click(screen.getByLabelText('Solo en conflicto'));

      await waitFor(() =>
        expect(lastListQuery()).toEqual({
          inConflict: 'true',
          order: 'desc',
          page: '1',
        }),
      );
    });

    it('el rango de estadía se envía cuando están las dos fechas; con una sola espera la otra', async () => {
      const user = userEvent.setup();
      renderAt('/reservas');
      await screen.findByRole('table');

      await user.type(screen.getByLabelText('Desde'), '2026-10-02');

      expect(
        await screen.findByText(
          'Complete las dos fechas para filtrar por estadía.',
        ),
      ).toBeInTheDocument();
      expect(lastListQuery()).toEqual({ order: 'desc', page: '1' });

      await user.type(screen.getByLabelText('Hasta'), '2026-10-06');

      await waitFor(() =>
        expect(lastListQuery()).toEqual({
          dateFrom: '2026-10-02',
          dateTo: '2026-10-06',
          order: 'desc',
          page: '1',
        }),
      );
      expect(
        screen.queryByText('Complete las dos fechas para filtrar por estadía.'),
      ).not.toBeInTheDocument();
    });

    it('el orden ascendente conserva los filtros (FR-003a)', async () => {
      const user = userEvent.setup();
      renderAt('/reservas?status=ACTIVE&source=DIRECT');
      await screen.findByRole('table');

      await user.selectOptions(
        screen.getByLabelText('Orden'),
        'Llegada: más antigua primero',
      );

      await waitFor(() =>
        expect(lastListQuery()).toEqual({
          status: 'ACTIVE',
          source: 'DIRECT',
          order: 'asc',
          page: '1',
        }),
      );
    });

    it('la búsqueda se envía al pulsar "Buscar", sin los espacios de los extremos, y no con cada tecla', async () => {
      const user = userEvent.setup();
      renderAt('/reservas');
      await screen.findByRole('table');
      const before = listQueries().length;

      await user.type(screen.getByLabelText('Buscar'), '  BK-99812 ');
      expect(listQueries()).toHaveLength(before);
      await user.click(screen.getByRole('button', { name: 'Buscar' }));

      await waitFor(() =>
        expect(lastListQuery()).toEqual({
          search: 'BK-99812',
          order: 'desc',
          page: '1',
        }),
      );
    });

    it('"Limpiar filtros" quita todos los filtros, la búsqueda y el orden', async () => {
      const user = userEvent.setup();
      const router = renderAt(
        '/reservas?search=gomez&status=ACTIVE&source=OTA&inConflict=true&dateFrom=2026-10-02&dateTo=2026-10-06&order=asc&page=2',
      );
      await screen.findByRole('table');

      await user.click(screen.getByRole('button', { name: 'Limpiar filtros' }));

      await waitFor(() =>
        expect(lastListQuery()).toEqual({ order: 'desc', page: '1' }),
      );
      expect(router.state.location.search).toBe('');
      expect(screen.getByLabelText('Buscar')).toHaveValue('');
      expect(screen.getByLabelText('Estado')).toHaveValue('');
    });

    it('los filtros de la dirección se aplican al abrir la pantalla', async () => {
      renderAt(
        '/reservas?status=ACTIVE&source=DIRECT&dateFrom=2026-10-01&dateTo=2026-10-01&order=asc&page=2',
      );

      await screen.findByRole('table');
      expect(listQueries()).toEqual([
        {
          status: 'ACTIVE',
          source: 'DIRECT',
          dateFrom: '2026-10-01',
          dateTo: '2026-10-01',
          order: 'asc',
          page: '2',
        },
      ]);
      expect(screen.getByLabelText('Estado')).toHaveValue('ACTIVE');
      expect(screen.getByLabelText('Desde')).toHaveValue('2026-10-01');
    });
  });

  describe('la paginación (FR-001 y FR-003a)', () => {
    const page = (number: number) =>
      jsonResponse(
        listOf([DIRECT], { page: number, totalItems: 25, totalPages: 3 }),
      );

    it('informa el total y la página, y "Siguiente" pide la página siguiente con los mismos filtros y el mismo orden', async () => {
      const user = userEvent.setup();
      listAnswer = (query) => page(Number(query.get('page')));
      renderAt('/reservas?status=ACTIVE&order=asc');
      await screen.findByRole('table');

      const pagination = screen.getByRole('navigation', { name: 'Paginación' });
      expect(pagination).toHaveTextContent('25 reservas');
      expect(pagination).toHaveTextContent('Página 1 de 3');
      expect(
        within(pagination).getByRole('button', { name: 'Anterior' }),
      ).toBeDisabled();

      await user.click(
        within(pagination).getByRole('button', { name: 'Siguiente' }),
      );

      await waitFor(() =>
        expect(lastListQuery()).toEqual({
          status: 'ACTIVE',
          order: 'asc',
          page: '2',
        }),
      );
      expect(
        await screen.findByText('Página 2 de 3', { exact: false }),
      ).toBeInTheDocument();
    });

    it('en la última página "Siguiente" queda deshabilitado y "Anterior" vuelve', async () => {
      const user = userEvent.setup();
      listAnswer = (query) => page(Number(query.get('page')));
      renderAt('/reservas?page=3');
      await screen.findByRole('table');

      const pagination = screen.getByRole('navigation', { name: 'Paginación' });
      expect(
        within(pagination).getByRole('button', { name: 'Siguiente' }),
      ).toBeDisabled();

      await user.click(
        within(pagination).getByRole('button', { name: 'Anterior' }),
      );

      await waitFor(() =>
        expect(lastListQuery()).toEqual({ order: 'desc', page: '2' }),
      );
    });

    it('si se pide una página que no existe, muestra la que devolvió el backend: la última válida', async () => {
      listAnswer = () => page(3);
      renderAt('/reservas?page=9');

      await screen.findByRole('table');
      expect(
        screen.getByRole('navigation', { name: 'Paginación' }),
      ).toHaveTextContent('Página 3 de 3');
    });

    it('con una sola reserva dice "1 reserva"', async () => {
      renderAt('/reservas');

      await screen.findByRole('table');
      expect(
        screen.getByRole('navigation', { name: 'Paginación' }),
      ).toHaveTextContent('1 reserva');
    });
  });

  describe('los demás estados de la pantalla', () => {
    it('sin resultados muestra el mensaje del backend y ninguna tabla (FR-010)', async () => {
      listAnswer = () => jsonResponse(listOf([]));
      renderAt('/reservas?status=NO_SHOW');

      expect(await screen.findByText(NO_RESULTS_MESSAGE)).toBeInTheDocument();
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
      expect(
        screen.queryByRole('navigation', { name: 'Paginación' }),
      ).not.toBeInTheDocument();
    });

    it('mientras responde muestra "Cargando reservas…" y ninguna tabla', async () => {
      listAnswer = () => new Promise<Response>(() => undefined) as never;
      renderAt('/reservas');

      expect(await screen.findByText('Cargando reservas…')).toBeInTheDocument();
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });

    it('un error del backend se muestra tal cual, y los filtros siguen para corregirlo', async () => {
      listAnswer = () =>
        errorResponse(
          'INVALID_RESERVATION_CODE',
          'Debe proveer un código de reserva válido para la consulta.',
        );
      renderAt('/reservas?search=ana.perez');

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Debe proveer un código de reserva válido para la consulta.',
      );
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Buscar')).toHaveValue('ana.perez');
    });
  });

  describe('cómo se llega a la pantalla', () => {
    it('la navegación lleva a la pantalla', async () => {
      const router = renderAt('/');

      await userEvent.click(
        within(screen.getByRole('navigation', { name: 'Principal' })).getByRole(
          'link',
          { name: 'Reservas' },
        ),
      );

      expect(router.state.location.pathname).toBe('/reservas');
      expect(await screen.findByRole('table')).toBeInTheDocument();
    });

    it('el inicio lleva a la pantalla', async () => {
      const router = renderAt('/');

      await userEvent.click(
        within(screen.getByRole('main')).getByRole('link', {
          name: 'Reservas',
        }),
      );

      expect(router.state.location.pathname).toBe('/reservas');
      expect(await screen.findByRole('table')).toBeInTheDocument();
    });

    it('toda consulta lleva X-Client: RECEPTIONIST', async () => {
      renderAt('/reservas');

      await screen.findByRole('table');
      for (const [, init] of fetchMock.mock.calls) {
        expect(init?.headers).toMatchObject({ 'X-Client': 'RECEPTIONIST' });
      }
    });
  });
});
