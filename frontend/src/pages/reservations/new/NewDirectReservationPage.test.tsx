import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../../../routes.tsx';
import type {
  DirectPreview,
  GuestLookup,
} from '../../../services/direct-reservation.ts';
import { createQueryClient } from '../../../services/query-client.ts';
import { signIn } from '../../../services/session.ts';

/** El inventario del Módulo 1: la 201 y la 202 de `DOBLE` y la 305 de `SUITE`. */
const ROOMS = {
  items: [
    { id: 'r201', roomNumber: '201', categoryRoom: 'DOBLE', maxCapacity: 2 },
    { id: 'r202', roomNumber: '202', categoryRoom: 'DOBLE', maxCapacity: 2 },
    { id: 'r305', roomNumber: '305', categoryRoom: 'SUITE', maxCapacity: 2 },
  ].map((room) => ({
    ...room,
    maintenance: {
      status: 'NONE',
      maintenanceStart: null,
      maintenanceEnd: null,
    },
  })),
  total: 3,
};

/** La respuesta del ejemplo de A del plan, con las dos habitaciones de la solicitud. */
const PREVIEW: DirectPreview = {
  availability: {
    startDate: '2026-10-12',
    endDate: '2026-10-15',
    categoryRoom: 'DOBLE',
    availableCount: 3,
  },
  assignedRooms: [
    {
      position: 1,
      roomId: 'r201',
      roomNumber: '201',
      maxCapacity: 2,
      guestCount: 2,
    },
    {
      position: 2,
      roomId: 'r202',
      roomNumber: '202',
      maxCapacity: 2,
      guestCount: 1,
    },
  ],
  quotes: {
    rooms: ['1', '2'].map((key) => ({
      key,
      categoryRoom: 'DOBLE',
      nights: 3,
      nightlyRates: [
        { date: '2026-10-12', rate: { amount: '250000.00', currency: 'COP' } },
      ],
      lodgingAmount: { amount: '750000.00', currency: 'COP' },
    })),
    total: { amount: '1500000.00', currency: 'COP' },
  },
  reservation: { guestCount: 3 },
};

/** El titular del ejemplo de E del plan. */
const FOUND: GuestLookup = {
  found: true,
  guest: {
    firstName: 'Ana',
    lastName: 'Pérez',
    documentType: 'CC',
    documentNumber: '123',
    nationality: 'Colombia',
    contactPhone: '+57 300 000 0000',
    contactEmail: 'ana@correo.com',
  },
};

const fetchMock = vi.fn<typeof fetch>();

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const errorResponse = (errorCode: string, message: string, path: string) =>
  jsonResponse(
    { errorCode, message, timestamp: '2026-10-09T15:15:20.000Z', path },
    400,
  );

/** Lo que responde cada ruta en la prueba. */
let previewAnswer: () => Response | Promise<Response>;
let createAnswer: () => Response;
let lookupAnswer: () => Response;

const callsTo = (path: string) =>
  fetchMock.mock.calls.filter(([input]) => String(input).startsWith(path));
const bodyOf = (call: Parameters<typeof fetch>) =>
  JSON.parse(String(call[1]?.body)) as Record<string, unknown>;
const headersOf = (call: Parameters<typeof fetch>) =>
  call[1]?.headers as Record<string, string>;

function renderNew() {
  signIn('Laura Méndez');
  const router = createMemoryRouter(routes, {
    initialEntries: ['/reservas/nueva'],
  });
  render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

/** Llena la estadía: fechas, categoría y dos habitaciones (2 y 1 personas). */
async function fillStay(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Fecha de entrada'), '2026-10-12');
  await user.type(screen.getByLabelText('Fecha de salida'), '2026-10-15');
  await user.selectOptions(
    await screen.findByLabelText('Categoría'),
    await screen.findByRole('option', { name: 'DOBLE' }),
  );
  await user.click(
    screen.getByRole('button', { name: '+ Agregar habitación' }),
  );
}

/** Llena el titular. */
async function fillHolder(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('No. documento'), '1144093552');
  await user.type(screen.getByLabelText('Nombres'), 'Valentina');
  await user.type(screen.getByLabelText('Apellidos'), 'Ospina');
  await user.type(screen.getByLabelText('País de origen'), 'Colombia');
}

describe('Pantalla "Nueva reserva directa" (T014 de generate-direct-reservation)', () => {
  beforeEach(() => {
    previewAnswer = () => jsonResponse(PREVIEW);
    createAnswer = () => jsonResponse({ reservationRef: 'RSV-3F9A1C7B' }, 201);
    lookupAnswer = () => jsonResponse(FOUND);
    fetchMock.mockImplementation((input) => {
      const path = String(input);
      if (path === '/api/rooms') {
        return Promise.resolve(jsonResponse(ROOMS));
      }
      if (path === '/api/reservations/direct/preview') {
        return Promise.resolve(previewAnswer());
      }
      if (path === '/api/reservations/direct') {
        return Promise.resolve(createAnswer());
      }
      if (path.startsWith('/api/guests/lookup')) {
        return Promise.resolve(lookupAnswer());
      }
      // El detalle de la reserva creada.
      return Promise.resolve(
        errorResponse('RESERVATION_NOT_FOUND', 'La reserva no existe.', path),
      );
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  it('el listado tiene el enlace "+ Nueva reserva directa", que abre esta pantalla', async () => {
    signIn('Laura Méndez');
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        jsonResponse({
          items: [],
          page: 1,
          pageSize: 10,
          totalItems: 0,
          totalPages: 0,
          message: null,
        }),
      ),
    );
    const router = createMemoryRouter(routes, {
      initialEntries: ['/reservas'],
    });
    render(
      <QueryClientProvider client={createQueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByRole('link', { name: '+ Nueva reserva directa' }),
    ).toHaveAttribute('href', '/reservas/nueva');
  });

  it('las categorías salen del inventario, sin repetir', async () => {
    renderNew();

    await screen.findByRole('option', { name: 'DOBLE' });
    expect(
      within(screen.getByLabelText('Categoría'))
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Elegir…', 'DOBLE', 'SUITE']);
  });

  it('sin fechas ni categoría no pide la vista previa y no deja crear', async () => {
    renderNew();

    await screen.findByRole('option', { name: 'DOBLE' });
    expect(
      screen.getByText(
        'Elija las fechas, la categoría y las personas de cada habitación.',
      ),
    ).toBeInTheDocument();
    expect(callsTo('/api/reservations/direct/preview')).toHaveLength(0);
    expect(
      screen.getByRole('button', { name: 'Crear reserva' }),
    ).toBeDisabled();
  });

  it('al elegir fechas, categoría y habitaciones pide la vista previa sola y muestra cada habitación con su tarifa y el total', async () => {
    const user = userEvent.setup();
    renderNew();

    await fillStay(user);
    await user.clear(screen.getByLabelText('Personas en la habitación 2'));
    await user.type(screen.getByLabelText('Personas en la habitación 2'), '1');

    expect(
      await screen.findByText('3 habitaciones DOBLE disponibles.'),
    ).toBeInTheDocument();
    const last = callsTo('/api/reservations/direct/preview').at(-1);
    expect(last?.[1]?.method).toBe('POST');
    expect(bodyOf(last as Parameters<typeof fetch>)).toEqual({
      startDate: '2026-10-12',
      endDate: '2026-10-15',
      categoryRoom: 'DOBLE',
      rooms: [{ guestCount: 2 }, { guestCount: 1 }],
    });
    const rows = within(screen.getByRole('table'))
      .getAllByRole('row')
      .map((row) => row.textContent);
    expect(rows).toEqual([
      'HabitaciónPersonasNochesTarifa',
      '20123750.000,00 COP',
      '20213750.000,00 COP',
      'Total1.500.000,00 COP',
    ]);
  });

  it('si la vista previa falla, muestra el mensaje del backend y no deja crear', async () => {
    previewAnswer = () =>
      errorResponse(
        'NO_AVAILABILITY',
        'No hay habitaciones disponibles para la categoría y fechas solicitadas.',
        '/api/reservations/direct/preview',
      );
    const user = userEvent.setup();
    renderNew();

    await fillStay(user);

    expect(
      await screen.findByText(
        'No hay habitaciones disponibles para la categoría y fechas solicitadas.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Crear reserva' }),
    ).toBeDisabled();
  });

  it('agregar y quitar habitaciones: de 1 a 10', async () => {
    const user = userEvent.setup();
    renderNew();

    await screen.findByRole('option', { name: 'DOBLE' });
    expect(
      screen.queryByRole('button', { name: 'Quitar' }),
    ).not.toBeInTheDocument();
    for (let i = 0; i < 9; i++) {
      await user.click(
        screen.getByRole('button', { name: '+ Agregar habitación' }),
      );
    }
    expect(screen.getAllByLabelText(/Personas en la habitación/)).toHaveLength(
      10,
    );
    expect(
      screen.queryByRole('button', { name: '+ Agregar habitación' }),
    ).not.toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Quitar' })[0]);
    expect(screen.getAllByLabelText(/Personas en la habitación/)).toHaveLength(
      9,
    );
  });

  it('"Buscar titular" precarga los datos de la última reserva con ese documento', async () => {
    const user = userEvent.setup();
    renderNew();

    await user.type(screen.getByLabelText('No. documento'), ' 123 ');
    await user.click(screen.getByRole('button', { name: 'Buscar titular' }));

    expect(
      await screen.findByText(
        'Se precargaron los datos de la última reserva con ese documento.',
      ),
    ).toBeInTheDocument();
    expect(callsTo('/api/guests/lookup')[0][0]).toBe(
      '/api/guests/lookup?documentType=CC&documentNumber=123',
    );
    expect(screen.getByLabelText('Nombres')).toHaveValue('Ana');
    expect(screen.getByLabelText('Apellidos')).toHaveValue('Pérez');
    expect(screen.getByLabelText('País de origen')).toHaveValue('Colombia');
    expect(screen.getByLabelText('Teléfono (opcional)')).toHaveValue(
      '+57 300 000 0000',
    );
    expect(screen.getByLabelText('Email (opcional)')).toHaveValue(
      'ana@correo.com',
    );
  });

  it('sin reservas con ese documento lo dice y no borra lo escrito', async () => {
    lookupAnswer = () => jsonResponse({ found: false, guest: null });
    const user = userEvent.setup();
    renderNew();

    await user.type(screen.getByLabelText('Nombres'), 'Valentina');
    await user.type(screen.getByLabelText('No. documento'), '999');
    await user.click(screen.getByRole('button', { name: 'Buscar titular' }));

    expect(
      await screen.findByText(
        'No hay reservas con ese documento: escriba los datos del titular.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Nombres')).toHaveValue('Valentina');
  });

  it('"Crear reserva" envía la creación con el titular, las tarifas vistas y la Idempotency-Key, y abre el detalle', async () => {
    // Otra moneda que la de siempre: la de cada tarifa vista sale de la vista previa.
    previewAnswer = () =>
      jsonResponse(
        JSON.parse(JSON.stringify(PREVIEW).replaceAll('"COP"', '"USD"')),
      );
    const user = userEvent.setup();
    const router = renderNew();

    await fillStay(user);
    await fillHolder(user);
    await user.type(
      screen.getByLabelText('Observaciones (opcional)'),
      ' Llega tarde ',
    );
    await screen.findByText('3 habitaciones DOBLE disponibles.');
    await user.click(screen.getByRole('button', { name: 'Crear reserva' }));

    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/reservas/RSV-3F9A1C7B'),
    );
    const [creation] = callsTo('/api/reservations/direct').filter(
      ([input]) => String(input) === '/api/reservations/direct',
    );
    expect(creation[1]?.method).toBe('POST');
    expect(bodyOf(creation)).toEqual({
      startDate: '2026-10-12',
      endDate: '2026-10-15',
      categoryRoom: 'DOBLE',
      rooms: [{ guestCount: 2 }, { guestCount: 1 }],
      guest: {
        firstName: 'Valentina',
        lastName: 'Ospina',
        documentType: 'CC',
        documentNumber: '1144093552',
        nationality: 'Colombia',
        contactPhone: null,
        contactEmail: null,
      },
      notes: 'Llega tarde',
      expectedRates: [
        { position: 1, lodgingAmount: '750000.00', currency: 'USD' },
        { position: 2, lodgingAmount: '750000.00', currency: 'USD' },
      ],
    });
    expect(headersOf(creation)['Idempotency-Key']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('si la creación falla, muestra el mensaje del backend; reintentar lo mismo usa la misma Idempotency-Key', async () => {
    createAnswer = () =>
      errorResponse(
        'REQUEST_NOT_PROCESSED',
        'No fue posible procesar la solicitud.',
        '/api/reservations/direct',
      );
    const user = userEvent.setup();
    renderNew();

    await fillStay(user);
    await fillHolder(user);
    await screen.findByText('3 habitaciones DOBLE disponibles.');
    const previews = callsTo('/api/reservations/direct/preview').length;
    await user.click(screen.getByRole('button', { name: 'Crear reserva' }));
    expect(
      await screen.findByText('No fue posible procesar la solicitud.'),
    ).toBeInTheDocument();
    // No obliga a volver a cotizar: se reintenta lo mismo.
    expect(callsTo('/api/reservations/direct/preview')).toHaveLength(previews);
    await user.click(screen.getByRole('button', { name: 'Crear reserva' }));

    await waitFor(() =>
      expect(
        callsTo('/api/reservations/direct').filter(
          ([input]) => String(input) === '/api/reservations/direct',
        ),
      ).toHaveLength(2),
    );
    const [first, second] = callsTo('/api/reservations/direct').filter(
      ([input]) => String(input) === '/api/reservations/direct',
    );
    expect(headersOf(second)['Idempotency-Key']).toBe(
      headersOf(first)['Idempotency-Key'],
    );
  });

  it('si cambia algo de la solicitud, la Idempotency-Key es otra', async () => {
    createAnswer = () =>
      errorResponse(
        'REQUEST_NOT_PROCESSED',
        'No fue posible procesar la solicitud.',
        '/api/reservations/direct',
      );
    const user = userEvent.setup();
    renderNew();

    await fillStay(user);
    await fillHolder(user);
    await screen.findByText('3 habitaciones DOBLE disponibles.');
    await user.click(screen.getByRole('button', { name: 'Crear reserva' }));
    await screen.findByText('No fue posible procesar la solicitud.');
    await user.type(screen.getByLabelText('Apellidos'), ' Gómez');
    await user.click(screen.getByRole('button', { name: 'Crear reserva' }));

    await waitFor(() =>
      expect(
        callsTo('/api/reservations/direct').filter(
          ([input]) => String(input) === '/api/reservations/direct',
        ),
      ).toHaveLength(2),
    );
    const [first, second] = callsTo('/api/reservations/direct').filter(
      ([input]) => String(input) === '/api/reservations/direct',
    );
    expect(headersOf(second)['Idempotency-Key']).not.toBe(
      headersOf(first)['Idempotency-Key'],
    );
  });

  it.each([
    ['RATE_CHANGED', 'La tarifa cambió, vuelva a cotizar.'],
    [
      'NO_AVAILABILITY',
      'Error 400: La habitación no está disponible para el rango de fechas solicitado',
    ],
    [
      'AVAILABILITY_TAKEN',
      'Ya no hay disponibilidad para las fechas solicitadas.',
    ],
  ])(
    'si la creación responde %s, vuelve a pedir la vista previa y la siguiente creación lleva la tarifa nueva con otra Idempotency-Key',
    async (errorCode, message) => {
      let creations = 0;
      createAnswer = () =>
        ++creations === 1
          ? errorResponse(errorCode, message, '/api/reservations/direct')
          : jsonResponse({ reservationRef: 'RSV-3F9A1C7B' }, 201);
      const user = userEvent.setup();
      const router = renderNew();

      await fillStay(user);
      await fillHolder(user);
      await screen.findByText('3 habitaciones DOBLE disponibles.');
      const previews = callsTo('/api/reservations/direct/preview').length;
      // La tarifa que cotizará A desde ahora.
      // Queda en pausa hasta que la prueba la suelte.
      let release = () => {};
      const quoted = new Promise<void>((resolve) => (release = resolve));
      previewAnswer = () =>
        quoted.then(() =>
          jsonResponse(
            JSON.parse(
              JSON.stringify(PREVIEW).replaceAll('750000.00', '810000.00'),
            ),
          ),
        );
      await user.click(screen.getByRole('button', { name: 'Crear reserva' }));

      expect(await screen.findByText(message)).toBeInTheDocument();
      // Mientras se vuelve a cotizar, no se puede enviar la tarifa vieja.
      expect(
        screen.getByRole('button', { name: 'Crear reserva' }),
      ).toBeDisabled();
      release();
      // A se pidió otra vez y muestra la tarifa nueva en las dos habitaciones.
      expect(await screen.findAllByText('810.000,00 COP')).toHaveLength(2);
      expect(callsTo('/api/reservations/direct/preview')).toHaveLength(
        previews + 1,
      );
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'Crear reserva' }),
        ).toBeEnabled(),
      );
      await user.click(screen.getByRole('button', { name: 'Crear reserva' }));

      await waitFor(() =>
        expect(router.state.location.pathname).toBe('/reservas/RSV-3F9A1C7B'),
      );
      const [first, second] = callsTo('/api/reservations/direct').filter(
        ([input]) => String(input) === '/api/reservations/direct',
      );
      expect(bodyOf(second).expectedRates).toEqual([
        { position: 1, lodgingAmount: '810000.00', currency: 'COP' },
        { position: 2, lodgingAmount: '810000.00', currency: 'COP' },
      ]);
      expect(headersOf(second)['Idempotency-Key']).not.toBe(
        headersOf(first)['Idempotency-Key'],
      );
    },
  );
});
