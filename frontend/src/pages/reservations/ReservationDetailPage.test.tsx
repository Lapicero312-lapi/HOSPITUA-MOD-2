import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../../routes.tsx';
import { createQueryClient } from '../../services/query-client.ts';
import type { ReservationDetail } from '../../services/reservation-detail.ts';
import { signIn } from '../../services/session.ts';

/** El detalle del ejemplo de C3 del plan de `check-view-reservation`. */
const DIRECT: ReservationDetail = {
  reservationRef: 'RSV-3F9A1C7B',
  status: 'ACTIVE',
  source: 'DIRECT',
  externalConfirmationCode: null,
  otaName: null,
  startDate: '2026-10-23',
  endDate: '2026-10-25',
  nights: 2,
  guestCount: 3,
  notes: '',
  createdAt: '2026-10-01T09:14:00-05:00',
  conflict: null,
  rooms: [
    {
      roomId: 'a4c2e6f8-1b3d-4e5f-8a7b-9c0d1e2f3a4b',
      roomNumber: '204',
      categoryRoom: 'DOBLE',
      guestCount: 3,
      roomGrossAmount: { amount: '713000.00', currency: 'COP' },
      stayStatus: 'EXPECTED',
    },
  ],
  guest: {
    firstName: 'Valentina',
    lastName: 'Ospina',
    documentType: 'CC',
    documentNumber: '1144093552',
    nationality: 'Colombia',
    contactPhone: '+57 300 000 0000',
    contactEmail: 'valentina@correo.com',
  },
  cancellation: null,
};

/** Una reserva de Booking: sin tarifas y con el titular sin documento. */
const BOOKING: ReservationDetail = {
  ...DIRECT,
  reservationRef: 'RSV-0A1B2C3D',
  source: 'OTA',
  externalConfirmationCode: 'BK-99812',
  otaName: 'Booking.com',
  rooms: [{ ...DIRECT.rooms[0], roomGrossAmount: null }],
  guest: {
    firstName: 'Ana',
    lastName: 'Pérez',
    documentType: null,
    documentNumber: null,
    nationality: null,
    contactPhone: null,
    contactEmail: 'ana@correo.com',
  },
};

const fetchMock = vi.fn<typeof fetch>();

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/** La aplicación completa (rutas y consultas), con la Recepcionista ya identificada. */
const renderDetail = (detail: ReservationDetail) => {
  fetchMock.mockResolvedValue(jsonResponse(detail));
  signIn('Laura Méndez');
  const router = createMemoryRouter(routes, {
    initialEntries: [`/reservas/${detail.reservationRef}`],
  });
  render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
};

/** El valor que acompaña a una etiqueta dentro de la sección con ese título. */
const fieldOf = (section: string, label: string) => {
  const heading = screen.getByRole('heading', { name: section });
  const term = within(heading.parentElement as HTMLElement).getByText(label, {
    selector: 'dt',
  });
  return term.nextElementSibling?.textContent;
};

/** El texto de cada celda de la tabla de habitaciones, fila por fila, sin los títulos ni el total. */
const roomRows = () =>
  within(screen.getByRole('table'))
    .getAllByRole('row')
    .slice(1)
    .filter((row) => within(row).queryAllByRole('cell').length === 5)
    .map((row) =>
      within(row)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    );

/**
 * La pantalla "Detalle de la reserva" con `GET /api/reservations/{reservationRef}` (C3 del plan de
 * `check-view-reservation`) simulado.
 */
describe('Pantalla "Detalle de la reserva"', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  describe('la reserva del ejemplo de C3 (FR-006)', () => {
    it('pide el detalle de la referencia de la dirección', async () => {
      renderDetail(DIRECT);

      await screen.findByRole('heading', { name: 'Reserva RSV-3F9A1C7B' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('/api/reservations/RSV-3F9A1C7B');
      expect(init?.method).toBe('GET');
      expect(init?.headers).toMatchObject({ 'X-Client': 'RECEPTIONIST' });
    });

    it('muestra el estado y los datos de la estadía: canal, fechas, noches, personas y creación', async () => {
      renderDetail(DIRECT);

      await screen.findByRole('heading', { name: 'Reserva RSV-3F9A1C7B' });
      expect(screen.getByText('Activa')).toBeInTheDocument();
      expect(fieldOf('Estadía y tarifa', 'Canal')).toBe('Directo');
      expect(fieldOf('Estadía y tarifa', 'Fecha de entrada')).toBe(
        '23/10/2026',
      );
      expect(fieldOf('Estadía y tarifa', 'Fecha de salida')).toBe('25/10/2026');
      expect(fieldOf('Estadía y tarifa', 'Noches')).toBe('2');
      expect(fieldOf('Estadía y tarifa', 'Personas')).toBe('3');
      expect(fieldOf('Estadía y tarifa', 'Creada el')).toBe('01/10/2026 09:14');
    });

    it('muestra cada habitación con su categoría, sus personas, su valor bruto y su estado en la reserva', async () => {
      renderDetail(DIRECT);

      await screen.findByRole('table');
      expect(
        screen.getAllByRole('columnheader').map((header) => header.textContent),
      ).toEqual([
        'Habitación',
        'Categoría',
        'Personas',
        'Valor bruto',
        'Estado en la reserva',
      ]);
      expect(roomRows()).toEqual([
        ['204', 'DOBLE', '3', '713.000,00 COP', 'Esperada'],
      ]);
    });

    it('muestra los datos del titular, con el tipo de documento por su nombre', async () => {
      renderDetail(DIRECT);

      await screen.findByRole('heading', { name: 'Datos del huésped' });
      expect(fieldOf('Datos del huésped', 'Nombre completo')).toBe(
        'Valentina Ospina',
      );
      expect(fieldOf('Datos del huésped', 'Tipo de documento')).toBe(
        'Cédula de ciudadanía',
      );
      expect(fieldOf('Datos del huésped', 'Documento')).toBe('1144093552');
      expect(fieldOf('Datos del huésped', 'Nacionalidad')).toBe('Colombia');
      expect(fieldOf('Datos del huésped', 'Teléfono')).toBe('+57 300 000 0000');
      expect(fieldOf('Datos del huésped', 'Email')).toBe(
        'valentina@correo.com',
      );
    });

    it('sin observaciones muestra una raya, no un campo vacío', async () => {
      renderDetail(DIRECT);
      await screen.findByRole('table');
      expect(fieldOf('Estadía y tarifa', 'Observaciones')).toBe('—');
    });

    it('con observaciones muestra su texto', async () => {
      renderDetail({ ...DIRECT, notes: 'Llegada después de las 8 p. m.' });

      await screen.findByRole('table');
      expect(fieldOf('Estadía y tarifa', 'Observaciones')).toBe(
        'Llegada después de las 8 p. m.',
      );
    });
  });

  it('una reserva de Booking no tiene tarifas: una raya en el valor bruto', async () => {
    renderDetail(BOOKING);

    await screen.findByRole('table');
    expect(roomRows()[0][3]).toBe('—');
  });

  describe('una reserva de Booking', () => {
    it('muestra la agencia y su código de confirmación', async () => {
      renderDetail(BOOKING);

      await screen.findByRole('table');
      expect(fieldOf('Estadía y tarifa', 'Canal')).toBe('OTA · Booking.com');
      expect(fieldOf('Estadía y tarifa', 'Código de la OTA')).toBe('BK-99812');
    });

    it('el titular sin documento, nacionalidad ni teléfono muestra una raya en cada uno', async () => {
      renderDetail(BOOKING);

      await screen.findByRole('table');
      expect(fieldOf('Datos del huésped', 'Tipo de documento')).toBe('—');
      expect(fieldOf('Datos del huésped', 'Documento')).toBe('—');
      expect(fieldOf('Datos del huésped', 'Nacionalidad')).toBe('—');
      expect(fieldOf('Datos del huésped', 'Teléfono')).toBe('—');
      expect(fieldOf('Datos del huésped', 'Email')).toBe('ana@correo.com');
    });

    it('una reserva directa no muestra el código de la OTA', async () => {
      renderDetail(DIRECT);

      await screen.findByRole('table');
      expect(screen.queryByText('Código de la OTA')).not.toBeInTheDocument();
    });

    it('en conflicto con una habitación sin asignar: muestra el motivo, desde cuándo, "Sin asignar" y la acción "Asignar habitación"', async () => {
      renderDetail({
        ...BOOKING,
        conflict: {
          reason: 'NO_ROOM_AVAILABLE',
          // El backend envía este instante en UTC: son las 09:00 de Colombia.
          detectedAt: '2026-10-08T14:00:00.000Z',
        },
        rooms: [
          {
            ...BOOKING.rooms[0],
            roomId: null,
            roomNumber: null,
          },
        ],
      });

      expect(await screen.findByRole('status')).toHaveTextContent(
        'En conflicto: No hay habitación disponible, desde el 08/10/2026 09:00.',
      );
      expect(roomRows()[0][0]).toBe('Sin asignar');
      expect(
        screen.getByRole('link', { name: 'Asignar habitación' }),
      ).toHaveAttribute('href', '/reservas/RSV-0A1B2C3D/asignar-habitacion');
    });

    it('nunca se puede modificar ni cancelar desde aquí: su cancelación llega de Booking', async () => {
      renderDetail(BOOKING);

      await screen.findByRole('table');
      expect(
        screen.queryByRole('link', { name: 'Modificar' }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('link', { name: 'Cancelar reserva' }),
      ).not.toBeInTheDocument();
    });
  });

  describe('las acciones (FR-005)', () => {
    it.each(['ACTIVE', 'PENDING'] as const)(
      'una reserva directa %s se puede modificar y cancelar',
      async (status) => {
        renderDetail({ ...DIRECT, status });

        await screen.findByRole('table');
        expect(screen.getByRole('link', { name: 'Modificar' })).toHaveAttribute(
          'href',
          '/reservas/RSV-3F9A1C7B/modificar',
        );
        expect(
          screen.getByRole('link', { name: 'Cancelar reserva' }),
        ).toHaveAttribute('href', '/reservas/RSV-3F9A1C7B/cancelar');
      },
    );

    it.each(['IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW'] as const)(
      'una reserva directa %s no tiene Modificar ni Cancelar',
      async (status) => {
        renderDetail({ ...DIRECT, status });

        await screen.findByRole('table');
        expect(
          screen.queryByRole('link', { name: 'Modificar' }),
        ).not.toBeInTheDocument();
        expect(
          screen.queryByRole('link', { name: 'Cancelar reserva' }),
        ).not.toBeInTheDocument();
      },
    );

    it('sin conflicto no hay "Asignar habitación"', async () => {
      renderDetail(DIRECT);

      await screen.findByRole('table');
      expect(
        screen.queryByRole('link', { name: 'Asignar habitación' }),
      ).not.toBeInTheDocument();
    });

    it('"← Volver a reservas" lleva al listado', async () => {
      renderDetail(DIRECT);

      await screen.findByRole('table');
      expect(
        screen.getByRole('link', { name: '← Volver a reservas' }),
      ).toHaveAttribute('href', '/reservas');
    });
  });

  describe('una reserva cancelada (escenario 4 de la historia 2)', () => {
    const CANCELLED: ReservationDetail = {
      ...DIRECT,
      status: 'CANCELLED',
      cancellation: {
        cancellationDate: '2026-10-09T10:15:20-05:00',
        channel: 'RECEPTION',
        reason: 'El huésped cambió de planes',
        processedBy: 'laura.mendez',
      },
    };

    it('muestra la fecha, el canal, el motivo y quién procesó la cancelación', async () => {
      renderDetail(CANCELLED);

      await screen.findByRole('heading', { name: 'Cancelación' });
      expect(fieldOf('Cancelación', 'Fecha')).toBe('09/10/2026 10:15');
      expect(fieldOf('Cancelación', 'Canal')).toBe('Recepción');
      expect(fieldOf('Cancelación', 'Motivo')).toBe(
        'El huésped cambió de planes',
      );
      expect(fieldOf('Cancelación', 'Procesada por')).toBe('laura.mendez');
    });

    it('una cancelación de Booking sin motivo muestra "Booking" y una raya', async () => {
      renderDetail({
        ...CANCELLED,
        cancellation: {
          cancellationDate: '2026-10-09T10:15:20-05:00',
          channel: 'OTA_API',
          reason: null,
          processedBy: 'Booking.com',
        },
      });

      await screen.findByRole('heading', { name: 'Cancelación' });
      expect(fieldOf('Cancelación', 'Canal')).toBe('Booking');
      expect(fieldOf('Cancelación', 'Motivo')).toBe('—');
    });

    it('una reserva sin cancelación no muestra esa sección (el No-Show no la tiene)', async () => {
      renderDetail({ ...DIRECT, status: 'NO_SHOW' });

      await screen.findByRole('table');
      expect(
        screen.queryByRole('heading', { name: 'Cancelación' }),
      ).not.toBeInTheDocument();
    });
  });

  it.each([
    ['EXPECTED', 'Esperada'],
    ['CHECKED_IN', 'Con Check-In'],
    ['CHECKED_OUT', 'Con Check-Out'],
    ['NOT_ARRIVED', 'No llegó'],
  ] as const)(
    'el estado %s de una habitación se muestra "%s"',
    async (stayStatus, text) => {
      renderDetail({
        ...DIRECT,
        rooms: [{ ...DIRECT.rooms[0], stayStatus }],
      });

      await screen.findByRole('table');
      expect(roomRows()[0][4]).toBe(text);
    },
  );

  it('las fechas con hora se muestran en hora de Colombia, aunque el computador esté en otra zona horaria', async () => {
    vi.stubEnv('TZ', 'Asia/Tokyo');
    renderDetail({ ...DIRECT, createdAt: '2026-10-01T23:30:00-05:00' });

    await screen.findByRole('table');
    expect(fieldOf('Estadía y tarifa', 'Creada el')).toBe('01/10/2026 23:30');
  });

  it('en conflicto pero con todas las habitaciones asignadas no hay "Asignar habitación": no queda ninguna por ubicar', async () => {
    renderDetail({
      ...BOOKING,
      conflict: {
        reason: 'CHANGE_NOT_APPLICABLE',
        detectedAt: '2026-10-08T14:00:00.000Z',
      },
    });

    expect(await screen.findByRole('status')).toHaveTextContent(
      'En conflicto: El cambio de Booking no se pudo aplicar',
    );
    expect(
      screen.queryByRole('link', { name: 'Asignar habitación' }),
    ).not.toBeInTheDocument();
  });

  it('con una habitación sin asignar pero sin conflicto no hay "Asignar habitación": la acción es solo para resolver un conflicto', async () => {
    renderDetail({
      ...BOOKING,
      rooms: [{ ...BOOKING.rooms[0], roomId: null, roomNumber: null }],
    });

    await screen.findByRole('table');
    expect(roomRows()[0][0]).toBe('Sin asignar');
    expect(
      screen.queryByRole('link', { name: 'Asignar habitación' }),
    ).not.toBeInTheDocument();
  });

  describe('los demás estados de la pantalla', () => {
    it('mientras responde muestra "Cargando reserva…"', async () => {
      fetchMock.mockReturnValue(new Promise<Response>(() => undefined));
      signIn('Laura Méndez');
      render(
        <QueryClientProvider client={createQueryClient()}>
          <RouterProvider
            router={createMemoryRouter(routes, {
              initialEntries: ['/reservas/RSV-3F9A1C7B'],
            })}
          />
        </QueryClientProvider>,
      );

      expect(await screen.findByText('Cargando reserva…')).toBeInTheDocument();
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });

    it.each([
      ['RESERVATION_NOT_FOUND', 'La reserva no existe.'],
      [
        'INVALID_RESERVATION_CODE',
        'Debe proveer un código de reserva válido para la consulta.',
      ],
    ])(
      'si el backend responde %s, muestra su mensaje tal cual y el enlace para volver',
      async (errorCode, message) => {
        fetchMock.mockResolvedValue(
          jsonResponse(
            {
              errorCode,
              message,
              timestamp: '2026-10-09T13:00:00.000Z',
              path: '/api/reservations/RSV-00000000',
            },
            400,
          ),
        );
        signIn('Laura Méndez');
        render(
          <QueryClientProvider client={createQueryClient()}>
            <RouterProvider
              router={createMemoryRouter(routes, {
                initialEntries: ['/reservas/RSV-00000000'],
              })}
            />
          </QueryClientProvider>,
        );

        expect(await screen.findByRole('alert')).toHaveTextContent(message);
        expect(screen.queryByRole('table')).not.toBeInTheDocument();
        expect(
          screen.getByRole('link', { name: '← Volver a reservas' }),
        ).toBeInTheDocument();
      },
    );
  });
});
