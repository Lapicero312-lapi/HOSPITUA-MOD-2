import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../../routes.tsx';
import type {
  GuestStay,
  GuestStayDetail,
  GuestStayPage,
} from '../../services/guest-stays.ts';
import { createQueryClient } from '../../services/query-client.ts';
import { signIn } from '../../services/session.ts';

const NO_GUEST_STAYS = 'No hay huéspedes que coincidan con los filtros.';

/** John, del ejemplo de C1 del plan: extranjero y en el hotel. */
const JOHN: GuestStay = {
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

/** Ana, colombiana, que ya salió. */
const ANA: GuestStay = {
  reservationRef: 'RSV-0A1B2C3D',
  guest: {
    firstName: 'Ana',
    lastName: 'Pérez',
    documentType: 'CC',
    documentNumber: '1020304050',
    nationality: 'Colombia',
    isForeign: false,
  },
  entryDate: '2026-03-02',
  exitDate: '2026-03-05',
  inHotel: false,
};

/** Un huésped con salida pero sin entrada registrada (caso borde del spec). */
const ONLY_DEPARTURE: GuestStay = {
  ...ANA,
  reservationRef: 'RSV-11112222',
  guest: { ...ANA.guest, firstName: 'Luis', documentNumber: '998877' },
  entryDate: null,
  exitDate: '2026-02-01',
};

/** El ejemplo de C2 del plan. */
const JOHN_DETAIL: GuestStayDetail = {
  reservationRef: 'RSV-3F9A1C7B',
  reservationLink: '/api/reservations/RSV-3F9A1C7B',
  guest: {
    documentType: 'PAS',
    documentNumber: 'X99',
    firstName: 'John',
    lastName: 'Smith',
    birthDate: '1990-05-12',
    nationality: 'Estados Unidos',
    isForeign: true,
    originPlace: 'Miami, Estados Unidos',
    destinationPlace: 'Cartagena, Colombia',
  },
  movements: [
    { movementType: 'ENTRY', movementDate: '2026-10-09' },
    { movementType: 'DEPARTURE', movementDate: '2026-10-12' },
  ],
};

const fetchMock = vi.fn<typeof fetch>();

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const pageOf = (
  items: GuestStay[],
  changes: Partial<GuestStayPage> = {},
): GuestStayPage => ({
  items,
  page: 1,
  pageSize: 10,
  totalItems: items.length,
  totalPages: items.length === 0 ? 0 : 1,
  message: items.length === 0 ? NO_GUEST_STAYS : null,
  ...changes,
});

const errorResponse = (errorCode: string, message: string) =>
  jsonResponse(
    {
      errorCode,
      message,
      timestamp: '2026-10-11T15:00:00.000Z',
      path: '/api/guest-stays',
    },
    400,
  );

/** Responde según la ruta: el listado (C1) y el detalle (C2). */
function backend(options: {
  list?: (url: URL) => Response;
  detail?: () => Response;
}) {
  fetchMock.mockImplementation((input) => {
    const url = new URL(String(input), 'http://localhost');
    if (url.pathname === '/api/guest-stays') {
      return Promise.resolve(
        options.list?.(url) ?? jsonResponse(pageOf([JOHN, ANA])),
      );
    }
    if (/^\/api\/reservations\/[^/]+\/guests\/[^/]+$/.test(url.pathname)) {
      return Promise.resolve(options.detail?.() ?? jsonResponse(JOHN_DETAIL));
    }
    return Promise.reject(new Error(`Ruta no esperada: ${url.pathname}`));
  });
}

/** Los parámetros de la última consulta del listado. */
const lastListQuery = () => {
  const calls = fetchMock.mock.calls
    .map(([input]) => new URL(String(input), 'http://localhost'))
    .filter((url) => url.pathname === '/api/guest-stays');
  return Object.fromEntries(calls[calls.length - 1].searchParams);
};

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

const table = () => screen.findByRole('table', { name: 'Huéspedes alojados' });

/** El texto de cada celda del listado, fila por fila, sin la columna de acciones. */
const rows = async () =>
  within(await table())
    .getAllByRole('row')
    .slice(1)
    .map((row) =>
      within(row)
        .getAllByRole('cell')
        .slice(0, 5)
        .map((cell) => cell.textContent),
    );

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * La pantalla "Huéspedes alojados" (spec de `process-guest-data`, historia 3, escenarios 1 a 8) con C1 y
 * C2 del plan.
 */
describe('Huéspedes alojados', () => {
  it('se llega desde la navegación principal', async () => {
    backend({});
    const user = userEvent.setup();
    const router = renderAt('/');

    await user.click(
      within(screen.getByRole('navigation', { name: 'Principal' })).getByRole(
        'link',
        { name: 'Huéspedes alojados' },
      ),
    );

    expect(router.state.location.pathname).toBe('/huespedes');
    expect(
      await screen.findByRole('heading', { name: 'Huéspedes alojados' }),
    ).toBeInTheDocument();
  });

  it('escenario 1: lista nombre, documento, nacionalidad con la marca de extranjero, reserva, entrada y salida o "En el hotel"', async () => {
    backend({ list: () => jsonResponse(pageOf([JOHN, ANA, ONLY_DEPARTURE])) });
    renderAt('/huespedes');

    expect(await rows()).toEqual([
      [
        'John SmithPAS X99',
        'Estados UnidosExtranjero',
        'RSV-3F9A1C7B',
        '09/10/2026',
        'En el hotel',
      ],
      [
        'Ana PérezCC 1020304050',
        'Colombia',
        'RSV-0A1B2C3D',
        '02/03/2026',
        '05/03/2026',
      ],
      ['Luis PérezCC 998877', 'Colombia', 'RSV-11112222', '—', '01/02/2026'],
    ]);
    // Sin filtros, la primera consulta no envía ningún parámetro: el backend usa sus valores por defecto.
    expect(lastListQuery()).toEqual({});
  });

  it('pide la lista como la Recepcionista y es solo de consulta: no hay acciones para crear, editar ni borrar', async () => {
    backend({});
    renderAt('/huespedes');
    await table();

    const [, init] = fetchMock.mock.calls[0];
    expect(init?.method).toBe('GET');
    expect(init?.headers).toMatchObject({
      'X-Client': 'RECEPTIONIST',
      'X-User': 'Laura Méndez',
    });
    const actions = within(await table())
      .getAllByRole('button')
      .map((button) => button.textContent);
    expect(new Set(actions)).toEqual(new Set(['Ver detalle']));
  });

  it('la reserva de una fila lleva a su detalle', async () => {
    backend({});
    const user = userEvent.setup();
    const router = renderAt('/huespedes');

    await user.click(
      await screen.findByRole('link', { name: 'Ver reserva RSV-3F9A1C7B' }),
    );

    expect(router.state.location.pathname).toBe('/reservas/RSV-3F9A1C7B');
  });

  it('escenario 2: filtra por extranjeros y por colombianos', async () => {
    backend({});
    const user = userEvent.setup();
    const router = renderAt('/huespedes');
    await table();

    await user.selectOptions(screen.getByLabelText('Nacionalidad'), 'FOREIGN');
    await waitFor(() =>
      expect(lastListQuery()).toEqual({ nationality: 'FOREIGN' }),
    );
    expect(router.state.location.search).toBe('?nationality=FOREIGN');

    await user.selectOptions(
      screen.getByLabelText('Nacionalidad'),
      'COLOMBIAN',
    );
    await waitFor(() =>
      expect(lastListQuery()).toEqual({ nationality: 'COLOMBIAN' }),
    );
  });

  it('escenario 3: filtra quién está en el hotel y quién ya salió', async () => {
    backend({});
    const user = userEvent.setup();
    renderAt('/huespedes');
    await table();

    await user.selectOptions(screen.getByLabelText('Situación'), 'IN_HOTEL');
    await waitFor(() =>
      expect(lastListQuery()).toEqual({ presence: 'IN_HOTEL' }),
    );

    await user.selectOptions(screen.getByLabelText('Situación'), 'CHECKED_OUT');
    await waitFor(() =>
      expect(lastListQuery()).toEqual({ presence: 'CHECKED_OUT' }),
    );
  });

  it('escenario 4: filtra por periodo con las dos fechas', async () => {
    backend({});
    const user = userEvent.setup();
    const router = renderAt('/huespedes');
    await table();

    await user.type(screen.getByLabelText('Desde'), '2026-10-01');
    await user.type(screen.getByLabelText('Hasta'), '2026-10-31');

    await waitFor(() =>
      expect(lastListQuery()).toEqual({
        dateFrom: '2026-10-01',
        dateTo: '2026-10-31',
      }),
    );
    expect(router.state.location.search).toBe(
      '?dateFrom=2026-10-01&dateTo=2026-10-31',
    );
  });

  it('los filtros se combinan y se conservan al recargar la dirección', async () => {
    backend({});
    renderAt(
      '/huespedes?search=Smith&nationality=FOREIGN&presence=IN_HOTEL&dateFrom=2026-10-01&dateTo=2026-10-31',
    );
    await table();

    expect(lastListQuery()).toEqual({
      search: 'Smith',
      nationality: 'FOREIGN',
      presence: 'IN_HOTEL',
      dateFrom: '2026-10-01',
      dateTo: '2026-10-31',
    });
    expect(screen.getByLabelText('Buscar')).toHaveValue('Smith');
    expect(screen.getByLabelText('Nacionalidad')).toHaveValue('FOREIGN');
    expect(screen.getByLabelText('Situación')).toHaveValue('IN_HOTEL');
    expect(screen.getByLabelText('Desde')).toHaveValue('2026-10-01');
    expect(screen.getByLabelText('Hasta')).toHaveValue('2026-10-31');
  });

  it('escenario 5: busca por documento o por nombre al enviar la búsqueda, sin los espacios de los extremos', async () => {
    backend({});
    const user = userEvent.setup();
    renderAt('/huespedes');
    await table();

    await user.type(screen.getByLabelText('Buscar'), '  X99 ');
    expect(lastListQuery()).toEqual({});
    await user.click(screen.getByRole('button', { name: 'Buscar' }));
    await waitFor(() => expect(lastListQuery()).toEqual({ search: 'X99' }));

    await user.clear(screen.getByLabelText('Buscar'));
    await user.type(screen.getByLabelText('Buscar'), 'smi{Enter}');
    await waitFor(() => expect(lastListQuery()).toEqual({ search: 'smi' }));
  });

  it('"Limpiar filtros" quita la búsqueda y todos los filtros', async () => {
    backend({});
    const user = userEvent.setup();
    const router = renderAt(
      '/huespedes?search=Smith&nationality=FOREIGN&presence=IN_HOTEL&dateFrom=2026-10-01&dateTo=2026-10-31&page=2',
    );
    await table();

    await user.click(screen.getByRole('button', { name: 'Limpiar filtros' }));

    await waitFor(() => expect(lastListQuery()).toEqual({}));
    expect(router.state.location.search).toBe('');
    expect(screen.getByLabelText('Buscar')).toHaveValue('');
  });

  it('escenario 7: sin resultados muestra el mensaje del backend', async () => {
    backend({ list: () => jsonResponse(pageOf([])) });
    renderAt('/huespedes?nationality=FOREIGN');

    expect(await screen.findByText(NO_GUEST_STAYS)).toBeInTheDocument();
    expect(
      screen.queryByRole('table', { name: 'Huéspedes alojados' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('navigation', { name: 'Paginación' }),
    ).not.toBeInTheDocument();
  });

  it.each([
    [
      'un rango invertido',
      { dateFrom: '2026-10-31', dateTo: '2026-10-01' },
      'INVALID_DATE_RANGE',
      'La fecha inicial no puede ser posterior a la fecha final.',
    ],
    [
      'un rango de más de un año',
      { dateFrom: '2025-01-01', dateTo: '2026-10-01' },
      'DATE_RANGE_TOO_LARGE',
      'El rango de fechas no puede superar 366 días.',
    ],
    [
      'una sola fecha',
      { dateFrom: '2026-10-01' },
      'INCOMPLETE_DATE_RANGE',
      'Debe completar ambas fechas del rango.',
    ],
    [
      'un nombre de menos de 3 letras',
      { search: 'Jo' },
      'NAME_SEARCH_TOO_SHORT',
      'La búsqueda por nombre requiere al menos 3 caracteres.',
    ],
  ])(
    'escenario 8: con %s muestra el mensaje del backend y no la tabla',
    async (_case, query, errorCode, message) => {
      backend({ list: () => errorResponse(errorCode, message) });
      renderAt(`/huespedes?${new URLSearchParams(query).toString()}`);

      expect(await screen.findByRole('alert')).toHaveTextContent(message);
      expect(lastListQuery()).toEqual(query);
      expect(
        screen.queryByRole('table', { name: 'Huéspedes alojados' }),
      ).not.toBeInTheDocument();
    },
  );

  it('escenario 8: al completar el rango desde la pantalla, se envía y se muestra el error de la fecha suelta', async () => {
    backend({
      list: (url) =>
        url.searchParams.has('dateFrom') !== url.searchParams.has('dateTo')
          ? errorResponse(
              'INCOMPLETE_DATE_RANGE',
              'Debe completar ambas fechas del rango.',
            )
          : jsonResponse(pageOf([JOHN])),
    });
    const user = userEvent.setup();
    renderAt('/huespedes');
    await table();

    await user.type(screen.getByLabelText('Desde'), '2026-10-01');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Debe completar ambas fechas del rango.',
    );

    await user.type(screen.getByLabelText('Hasta'), '2026-10-31');
    await table();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('escenario 1: pagina de a 10 y cambiar un filtro vuelve a la página 1', async () => {
    backend({
      list: (url) =>
        jsonResponse(
          pageOf([JOHN, ANA], {
            page: Number(url.searchParams.get('page') ?? '1'),
            totalItems: 23,
            totalPages: 3,
          }),
        ),
    });
    const user = userEvent.setup();
    const router = renderAt('/huespedes');
    await table();

    const pagination = screen.getByRole('navigation', { name: 'Paginación' });
    expect(pagination).toHaveTextContent(
      'Mostrando 1–2 de 23 huéspedes · página 1 de 3',
    );
    expect(
      within(pagination).getByRole('button', { name: '← Anterior' }),
    ).toBeDisabled();

    await user.click(
      within(pagination).getByRole('button', { name: 'Siguiente →' }),
    );
    await waitFor(() => expect(lastListQuery()).toEqual({ page: '2' }));
    expect(
      await screen.findByText(
        'Mostrando 11–12 de 23 huéspedes · página 2 de 3',
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Página 3' }));
    await waitFor(() => expect(lastListQuery()).toEqual({ page: '3' }));
    expect(
      await screen.findByRole('button', { name: 'Siguiente →' }),
    ).toBeDisabled();

    await user.selectOptions(screen.getByLabelText('Situación'), 'IN_HOTEL');
    await waitFor(() =>
      expect(lastListQuery()).toEqual({ presence: 'IN_HOTEL' }),
    );
    expect(router.state.location.search).toBe('?presence=IN_HOTEL');
  });

  it('muestra la página que devolvió el backend cuando la pedida no existe', async () => {
    backend({
      list: () =>
        jsonResponse(
          pageOf([JOHN], { page: 3, totalItems: 21, totalPages: 3 }),
        ),
    });
    renderAt('/huespedes?page=9');
    await table();

    expect(lastListQuery()).toEqual({ page: '9' });
    expect(
      screen.getByRole('navigation', { name: 'Paginación' }),
    ).toHaveTextContent('Mostrando 21–21 de 21 huéspedes · página 3 de 3');
  });

  describe('escenario 6: detalle de un huésped', () => {
    it('muestra todos sus datos, sus movimientos y el enlace a la reserva', async () => {
      backend({});
      const user = userEvent.setup();
      const router = renderAt('/huespedes');

      await user.click(
        await screen.findByRole('button', {
          name: 'Ver detalle de John Smith',
        }),
      );

      const dialog = await screen.findByRole('dialog', { name: 'John Smith' });
      const call = fetchMock.mock.calls
        .map(([input]) => String(input))
        .find((url) => url.includes('/guests/'));
      expect(call).toBe('/api/reservations/RSV-3F9A1C7B/guests/X99');
      expect(
        within(dialog).getByText('Documento').nextSibling,
      ).toHaveTextContent('PAS X99');
      expect(
        within(dialog).getByText('Fecha de nacimiento').nextSibling,
      ).toHaveTextContent('12/05/1990');
      expect(
        within(dialog).getByText('Nacionalidad').nextSibling,
      ).toHaveTextContent('Estados Unidos · extranjero');
      expect(within(dialog).getByText('Reserva').nextSibling).toHaveTextContent(
        'RSV-3F9A1C7B',
      );
      expect(
        within(dialog).getByText('Lugar de procedencia').nextSibling,
      ).toHaveTextContent('Miami, Estados Unidos');
      expect(
        within(dialog).getByText('Lugar de destino').nextSibling,
      ).toHaveTextContent('Cartagena, Colombia');
      const movements = within(
        within(dialog).getByRole('table', { name: 'Movimientos' }),
      )
        .getAllByRole('row')
        .slice(1)
        .map((row) => row.textContent);
      expect(movements).toEqual(['Entrada09/10/2026', 'Salida12/10/2026']);

      await user.click(
        within(dialog).getByRole('link', { name: 'Ver reserva' }),
      );
      expect(router.state.location.pathname).toBe('/reservas/RSV-3F9A1C7B');
    });

    it('muestra una raya en todo dato vacío, también en el nombre y la nacionalidad', async () => {
      backend({
        detail: () =>
          jsonResponse({
            ...JOHN_DETAIL,
            guest: {
              ...JOHN_DETAIL.guest,
              firstName: null,
              lastName: 'Pérez',
              nationality: null,
              isForeign: false,
              originPlace: null,
              destinationPlace: '',
            },
            movements: [{ movementType: 'ENTRY', movementDate: '2026-10-09' }],
          } satisfies GuestStayDetail),
      });
      const user = userEvent.setup();
      renderAt('/huespedes');

      await user.click(
        await screen.findByRole('button', {
          name: 'Ver detalle de John Smith',
        }),
      );

      const dialog = await screen.findByRole('dialog', { name: '— Pérez' });
      for (const label of [
        'Nacionalidad',
        'Lugar de procedencia',
        'Lugar de destino',
      ]) {
        expect(within(dialog).getByText(label).nextSibling).toHaveTextContent(
          /^—$/,
        );
      }
      expect(dialog).not.toHaveTextContent('null');
      expect(
        within(within(dialog).getByRole('table', { name: 'Movimientos' }))
          .getAllByRole('row')
          .slice(1)
          .map((row) => row.textContent),
      ).toEqual(['Entrada09/10/2026']);
    });

    it('con un huésped que no está muestra el mensaje del backend', async () => {
      backend({
        detail: () =>
          errorResponse(
            'GUEST_NOT_FOUND',
            'El huésped no existe en esa reserva.',
          ),
      });
      const user = userEvent.setup();
      renderAt('/huespedes');

      await user.click(
        await screen.findByRole('button', {
          name: 'Ver detalle de John Smith',
        }),
      );

      const dialog = await screen.findByRole('dialog');
      expect(await within(dialog).findByRole('alert')).toHaveTextContent(
        'El huésped no existe en esa reserva.',
      );
      expect(
        within(dialog).queryByRole('link', { name: 'Ver reserva' }),
      ).not.toBeInTheDocument();
    });

    it('se cierra con "Cerrar" y con Escape', async () => {
      backend({});
      const user = userEvent.setup();
      renderAt('/huespedes');

      await user.click(
        await screen.findByRole('button', {
          name: 'Ver detalle de John Smith',
        }),
      );
      const dialog = await screen.findByRole('dialog', { name: 'John Smith' });
      await user.click(within(dialog).getByRole('button', { name: 'Cerrar' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      await user.click(
        screen.getByRole('button', { name: 'Ver detalle de Ana Pérez' }),
      );
      await screen.findByRole('dialog');
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });
});
