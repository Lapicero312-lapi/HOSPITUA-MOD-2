import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../../../routes.tsx';
import type { ReservationDetail } from '../../../services/reservation-detail.ts';
import type { ModificationPreview } from '../../../services/reservation-modification.ts';
import { createQueryClient } from '../../../services/query-client.ts';
import { signIn } from '../../../services/session.ts';

const REF = 'RSV-3F9A1C7B';
const UPDATED_AT = '2026-10-08T15:42:10.123456-05:00';

/** El inventario del Módulo 1: la 201 y la 202 de `DOBLE` y la 305 de `SUITE`. */
const ROOMS = {
  items: [
    { id: 'r201', roomNumber: '201', categoryRoom: 'DOBLE', maxCapacity: 2 },
    { id: 'r202', roomNumber: '202', categoryRoom: 'DOBLE', maxCapacity: 2 },
    { id: 'r305', roomNumber: '305', categoryRoom: 'SUITE', maxCapacity: 3 },
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

/** Una reserva directa activa con la 201 (C3). */
const RESERVATION: ReservationDetail & { updatedAt: string } = {
  reservationRef: REF,
  status: 'ACTIVE',
  source: 'DIRECT',
  externalConfirmationCode: null,
  otaName: null,
  startDate: '2026-10-12',
  endDate: '2026-10-15',
  nights: 3,
  guestCount: 2,
  notes: 'Llegada tarde',
  createdAt: '2026-10-08T15:42:10-05:00',
  updatedAt: UPDATED_AT,
  conflict: null,
  rooms: [
    {
      roomId: 'r201',
      roomNumber: '201',
      categoryRoom: 'DOBLE',
      guestCount: 2,
      roomGrossAmount: { amount: '690000.00', currency: 'COP' },
      stayStatus: 'EXPECTED',
    },
  ],
  guest: {
    firstName: 'Ana',
    lastName: 'Pérez',
    documentType: 'CC',
    documentNumber: '123',
    nationality: 'Colombia',
    contactPhone: '+57 300 000 0000',
    contactEmail: 'ana@correo.com',
  },
  cancellation: null,
};

/** La vista previa del ejemplo de B1 del plan: se agrega la 305 y se cotiza solo ella. */
const PREVIEW: ModificationPreview = {
  reservationRef: REF,
  changes: {
    dates: false,
    roomsAdded: ['r305'],
    roomsRemoved: [],
    roomsSwapped: [],
    guestCountChanged: true,
    guestChanged: false,
    notesChanged: false,
  },
  requiresConfirmation: true,
  availability: {
    rooms: [
      { roomId: 'r305', roomNumber: '305', available: true, reason: null },
    ],
  },
  quotes: {
    rooms: [
      {
        key: 'r305',
        categoryRoom: 'SUITE',
        nights: 3,
        nightlyRates: [
          {
            date: '2026-10-12',
            rate: { amount: '480000.00', currency: 'COP' },
          },
        ],
        lodgingAmount: { amount: '1440000.00', currency: 'COP' },
      },
    ],
    total: { amount: '2130000.00', currency: 'COP' },
  },
  reservation: {
    startDate: '2026-10-12',
    endDate: '2026-10-15',
    guestCount: 3,
  },
};

/** Una vista previa sin nada que recotizar (solo datos, notas o personas). */
const NO_QUOTE: ModificationPreview = {
  ...PREVIEW,
  changes: { ...PREVIEW.changes, roomsAdded: [], guestCountChanged: false },
  requiresConfirmation: false,
  availability: { rooms: [] },
  quotes: null,
  reservation: { ...PREVIEW.reservation, guestCount: 2 },
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
let reservationAnswer: () => Response;
let previewAnswer: () => Response;
let confirmAnswer: () => Response;

const PREVIEW_PATH = `/api/reservations/${REF}/modification-preview`;
const DETAIL_PATH = `/api/reservations/${REF}`;

const previewCalls = () =>
  fetchMock.mock.calls.filter(([input]) => String(input) === PREVIEW_PATH);
const confirmCalls = () =>
  fetchMock.mock.calls.filter(
    ([input, init]) =>
      String(input) === DETAIL_PATH && init?.method === 'PATCH',
  );
const bodyOf = (call: Parameters<typeof fetch>) =>
  JSON.parse(String(call[1]?.body)) as Record<string, unknown>;

function renderAt(path = `/reservas/${REF}/modificar`) {
  signIn('Laura Méndez');
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

/** Agrega una fila y elige la 305 con una persona. */
async function addSuite(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    await screen.findByRole('button', { name: '+ Agregar habitación' }),
  );
  const second = screen.getByLabelText('Habitación 2');
  await user.selectOptions(
    second,
    await within(second).findByRole('option', { name: /^305 · SUITE/ }),
  );
}

describe('Pantalla "Modificar" (T014 de update-reservation)', () => {
  beforeEach(() => {
    reservationAnswer = () => jsonResponse(RESERVATION);
    previewAnswer = () => jsonResponse(PREVIEW);
    confirmAnswer = () => jsonResponse(RESERVATION);
    fetchMock.mockImplementation((input, init) => {
      const path = String(input);
      if (path === '/api/rooms') {
        return Promise.resolve(jsonResponse(ROOMS));
      }
      if (path === PREVIEW_PATH) {
        return Promise.resolve(previewAnswer());
      }
      if (path === DETAIL_PATH && init?.method === 'PATCH') {
        return Promise.resolve(confirmAnswer());
      }
      if (path === DETAIL_PATH) {
        return Promise.resolve(reservationAnswer());
      }
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

  it('el enlace "Modificar" del detalle abre esta pantalla', async () => {
    const user = userEvent.setup();
    const router = renderAt(`/reservas/${REF}`);

    await user.click(await screen.findByRole('link', { name: 'Modificar' }));

    expect(router.state.location.pathname).toBe(`/reservas/${REF}/modificar`);
    expect(
      await screen.findByRole('heading', { name: `Modificar reserva ${REF}` }),
    ).toBeInTheDocument();
  });

  it('empieza con los datos de la reserva; sin cambios no pide la vista previa y no deja guardar', async () => {
    renderAt();

    expect(await screen.findByLabelText('Fecha de entrada')).toHaveValue(
      '2026-10-12',
    );
    expect(screen.getByLabelText('Fecha de salida')).toHaveValue('2026-10-15');
    await waitFor(() =>
      expect(screen.getByLabelText('Habitación 1')).toHaveValue('r201'),
    );
    expect(screen.getByLabelText('Personas en la habitación 1')).toHaveValue(2);
    expect(screen.getByLabelText('Nombres')).toHaveValue('Ana');
    expect(screen.getByLabelText('Apellidos')).toHaveValue('Pérez');
    expect(screen.getByLabelText('Tipo de documento')).toHaveValue('CC');
    expect(screen.getByLabelText('Documento')).toHaveValue('123');
    expect(screen.getByLabelText('Teléfono (opcional)')).toHaveValue(
      '+57 300 000 0000',
    );
    expect(screen.getByLabelText('Email (opcional)')).toHaveValue(
      'ana@correo.com',
    );
    expect(screen.getByLabelText('Observaciones (opcional)')).toHaveValue(
      'Llegada tarde',
    );
    expect(screen.getByText('No hay cambios.')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Guardar cambios' }),
    ).toBeDisabled();
    expect(previewCalls()).toHaveLength(0);
  });

  it('al agregar una habitación pide la vista previa sola, con solo las habitaciones, y muestra la disponibilidad, la tarifa y el total', async () => {
    const user = userEvent.setup();
    renderAt();

    await addSuite(user);

    expect(await screen.findByText('Disponible')).toBeInTheDocument();
    expect(screen.getByText('1.440.000,00 COP')).toBeInTheDocument();
    expect(screen.getByText('2.130.000,00 COP')).toBeInTheDocument();
    expect(screen.getByText('Quedaría con 3 personas.')).toBeInTheDocument();
    expect(bodyOf(previewCalls().at(-1)!)).toEqual({
      updatedAt: UPDATED_AT,
      rooms: [
        { roomId: 'r201', guestCount: 2 },
        { roomId: 'r305', guestCount: 1 },
      ],
    });
    expect(
      screen.getByRole('button', { name: 'Guardar cambios' }),
    ).toBeEnabled();
  });

  it('una fila sin habitación no pide la vista previa; la habitación de otra fila no se puede elegir', async () => {
    const user = userEvent.setup();
    renderAt();

    await user.click(
      await screen.findByRole('button', { name: '+ Agregar habitación' }),
    );

    expect(
      screen.getByText(
        'Elija las dos fechas y una habitación con sus personas en cada fila.',
      ),
    ).toBeInTheDocument();
    expect(previewCalls()).toHaveLength(0);
    const second = screen.getByLabelText('Habitación 2');
    expect(
      await within(second).findByRole('option', { name: /^201 · DOBLE/ }),
    ).toBeDisabled();
    expect(
      within(second).getByRole('option', { name: /^202 · DOBLE/ }),
    ).toBeEnabled();
  });

  it('agrega y quita filas: nunca menos de 1 ni más de 10', async () => {
    const user = userEvent.setup();
    renderAt();

    await screen.findByLabelText('Habitación 1');
    expect(
      screen.queryByRole('button', { name: 'Quitar la habitación 1' }),
    ).not.toBeInTheDocument();
    for (let i = 0; i < 9; i++) {
      await user.click(
        screen.getByRole('button', { name: '+ Agregar habitación' }),
      );
    }
    expect(screen.getByLabelText('Habitación 10')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '+ Agregar habitación' }),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: 'Quitar la habitación 10' }),
    );
    expect(screen.queryByLabelText('Habitación 10')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '+ Agregar habitación' }),
    ).toBeInTheDocument();
  });

  it('al cambiar solo las personas de una habitación envía las habitaciones', async () => {
    previewAnswer = () => jsonResponse(NO_QUOTE);
    const user = userEvent.setup();
    renderAt();

    const guests = await screen.findByLabelText('Personas en la habitación 1');
    await user.clear(guests);
    await user.type(guests, '1');

    await screen.findByText('La tarifa no cambia.');
    expect(bodyOf(previewCalls().at(-1)!)).toEqual({
      updatedAt: UPDATED_AT,
      rooms: [{ roomId: 'r201', guestCount: 1 }],
    });
  });

  it('al cambiar las fechas envía las dos', async () => {
    const user = userEvent.setup();
    renderAt();

    const end = await screen.findByLabelText('Fecha de salida');
    await user.clear(end);
    await user.type(end, '2026-10-16');

    await waitFor(() => expect(previewCalls().length).toBeGreaterThan(0));
    expect(bodyOf(previewCalls().at(-1)!)).toEqual({
      updatedAt: UPDATED_AT,
      startDate: '2026-10-12',
      endDate: '2026-10-16',
    });
  });

  it('al corregir el titular envía el titular completo, sin la nacionalidad, sin espacios y con los vacíos en null', async () => {
    previewAnswer = () => jsonResponse(NO_QUOTE);
    const user = userEvent.setup();
    renderAt();

    const last = await screen.findByLabelText('Apellidos');
    await user.clear(last);
    await user.type(last, ' Pérez Gómez ');
    await user.clear(screen.getByLabelText('Teléfono (opcional)'));

    expect(await screen.findByText('La tarifa no cambia.')).toBeInTheDocument();
    expect(bodyOf(previewCalls().at(-1)!)).toEqual({
      updatedAt: UPDATED_AT,
      guest: {
        firstName: 'Ana',
        lastName: 'Pérez Gómez',
        documentType: 'CC',
        documentNumber: '123',
        contactPhone: null,
        contactEmail: 'ana@correo.com',
      },
    });
  });

  it('borrar las observaciones envía notes en null; sin nada que recotizar confirma sin tarifas y vuelve al detalle', async () => {
    previewAnswer = () => jsonResponse(NO_QUOTE);
    const user = userEvent.setup();
    const router = renderAt();

    await user.clear(await screen.findByLabelText('Observaciones (opcional)'));
    await screen.findByText('La tarifa no cambia.');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/reservas/${REF}`),
    );
    expect(bodyOf(previewCalls().at(-1)!)).toEqual({
      updatedAt: UPDATED_AT,
      notes: null,
    });
    expect(confirmCalls()).toHaveLength(1);
    expect(bodyOf(confirmCalls()[0])).toEqual({
      updatedAt: UPDATED_AT,
      notes: null,
      expectedRates: [],
    });
  });

  it('"Guardar cambios" confirma con PATCH, el cambio y las tarifas vistas con su moneda, y vuelve al detalle', async () => {
    // Otra moneda que la de siempre: la de cada tarifa vista sale de la vista previa.
    previewAnswer = () =>
      jsonResponse(
        JSON.parse(JSON.stringify(PREVIEW).replaceAll('"COP"', '"USD"')),
      );
    const user = userEvent.setup();
    const router = renderAt();

    await addSuite(user);
    await screen.findByText('1.440.000,00 USD');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/reservas/${REF}`),
    );
    expect(bodyOf(confirmCalls()[0])).toEqual({
      updatedAt: UPDATED_AT,
      rooms: [
        { roomId: 'r201', guestCount: 2 },
        { roomId: 'r305', guestCount: 1 },
      ],
      expectedRates: [
        { roomId: 'r305', lodgingAmount: '1440000.00', currency: 'USD' },
      ],
    });
  });

  it('si la vista previa falla, muestra el mensaje del backend y no deja guardar', async () => {
    previewAnswer = () =>
      errorResponse(
        'ROOM_NOT_AVAILABLE',
        'La habitación 305 no está disponible para el rango de fechas solicitado.',
        PREVIEW_PATH,
      );
    const user = userEvent.setup();
    renderAt();

    await addSuite(user);

    expect(
      await screen.findByText(
        'La habitación 305 no está disponible para el rango de fechas solicitado.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Guardar cambios' }),
    ).toBeDisabled();
  });

  it('si la tarifa cambió, muestra el mensaje y no ofrece volver a cargar', async () => {
    confirmAnswer = () =>
      errorResponse(
        'RATE_CHANGED',
        'La tarifa cambió, vuelva a cotizar.',
        DETAIL_PATH,
      );
    const user = userEvent.setup();
    renderAt();

    await addSuite(user);
    await screen.findByText('1.440.000,00 COP');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(
      await screen.findByText('La tarifa cambió, vuelva a cotizar.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Volver a cargar la reserva' }),
    ).not.toBeInTheDocument();
  });

  it('si otra persona la cambió, ofrece volver a cargarla y el formulario empieza con los datos de ahora', async () => {
    confirmAnswer = () =>
      errorResponse(
        'CONCURRENT_UPDATE',
        'Esta reserva ya fue actualizada o cancelada recientemente',
        DETAIL_PATH,
      );
    const user = userEvent.setup();
    renderAt();

    await addSuite(user);
    await screen.findByText('1.440.000,00 COP');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await screen.findByText(
      'Esta reserva ya fue actualizada o cancelada recientemente',
    );

    reservationAnswer = () =>
      jsonResponse({
        ...RESERVATION,
        notes: 'Cambiada por otra persona',
        updatedAt: '2026-10-08T16:00:00.000000-05:00',
      });
    await user.click(
      screen.getByRole('button', { name: 'Volver a cargar la reserva' }),
    );

    expect(
      await screen.findByDisplayValue('Cambiada por otra persona'),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Habitación 2')).not.toBeInTheDocument();
    expect(screen.getByText('No hay cambios.')).toBeInTheDocument();
  });

  it('una reserva de OTA no se modifica aquí: muestra el mensaje del plan y no el formulario', async () => {
    reservationAnswer = () =>
      jsonResponse({ ...RESERVATION, source: 'OTA', otaName: 'Booking' });
    renderAt();

    expect(
      await screen.findByText(
        'Las reservas de OTA solo las modifica Booking. Si está en conflicto, solo se le puede asignar la habitación.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Fecha de entrada')).not.toBeInTheDocument();
  });

  it('una reserva en curso no se modifica: muestra el mensaje del plan', async () => {
    reservationAnswer = () =>
      jsonResponse({ ...RESERVATION, status: 'IN_PROGRESS' });
    renderAt();

    expect(
      await screen.findByText(
        'El estado actual de la reserva no admite modificaciones.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Fecha de entrada')).not.toBeInTheDocument();
  });

  it('una reserva pendiente sí se modifica', async () => {
    reservationAnswer = () =>
      jsonResponse({ ...RESERVATION, status: 'PENDING' });
    renderAt();

    expect(await screen.findByLabelText('Fecha de entrada')).toHaveValue(
      '2026-10-12',
    );
  });
});
