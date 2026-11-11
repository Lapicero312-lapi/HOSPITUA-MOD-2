import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../../../routes.tsx';
import { createQueryClient } from '../../../services/query-client.ts';
import type {
  CancellationResult,
  ReservationToCancel,
} from '../../../services/reservation-cancellation.ts';
import { signIn } from '../../../services/session.ts';

/** El `updatedAt` del ejemplo de A del plan de `cancel-reservation`. */
const UPDATED_AT = '2026-10-08T15:42:10.123456-05:00';

/** La reserva del ejemplo de C3, con el `updatedAt` del ejemplo de A. */
const RESERVATION: ReservationToCancel = {
  reservationRef: 'RSV-3F9A1C7B',
  status: 'ACTIVE',
  source: 'DIRECT',
  startDate: '2026-10-23',
  endDate: '2026-10-25',
  nights: 2,
  guestCount: 3,
  updatedAt: UPDATED_AT,
  rooms: [{ roomNumber: '204', categoryRoom: 'DOBLE' }],
  guest: { firstName: 'Valentina', lastName: 'Ospina' },
};

/** La respuesta del ejemplo de A. */
const RESULT: CancellationResult = {
  reservationRef: 'RSV-3F9A1C7B',
  status: 'CANCELLED',
  cancellation: {
    cancellationId: '0b6f8a52-1c3d-4e5f-9a7b-1c2d3e4f5a6b',
    cancellationDate: '2026-10-09T10:15:20-05:00',
    channel: 'RECEPTION',
    reason: 'El huésped cambió de planes',
    processedBy: 'laura.mendez',
    status: 'COMPLETED',
  },
};

const CHECKBOX = 'Entiendo que la cancelación no se puede deshacer.';
const CONCURRENT_MESSAGE =
  'Esta reserva ya fue actualizada o cancelada recientemente';

const fetchMock = vi.fn<typeof fetch>();

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
      timestamp: '2026-10-09T15:15:20.000Z',
      path: '/api/reservations/RSV-3F9A1C7B/cancellation',
    },
    400,
  );

/** Lo que responde la lectura de la reserva (puede cambiar entre una lectura y la siguiente) y la cancelación. */
let readAnswers: Response[];
let cancelAnswer: () => Response | Promise<Response>;

/** Las cancelaciones enviadas: la dirección y el cuerpo. */
const cancellationsSent = () =>
  fetchMock.mock.calls
    .filter(([, init]) => init?.method === 'POST')
    .map(([url, init]) => ({
      url: String(url),
      body: JSON.parse(String(init?.body)) as unknown,
      headers: init?.headers,
    }));

const reads = () =>
  fetchMock.mock.calls.filter(([, init]) => init?.method === 'GET').length;

/** La aplicación completa (rutas y consultas), con la Recepcionista ya identificada. */
const renderCancel = (
  reservation: ReservationToCancel = RESERVATION,
  firstRead: Response = jsonResponse(reservation),
) => {
  readAnswers = [firstRead];
  signIn('laura.mendez');
  const router = createMemoryRouter(routes, {
    initialEntries: [`/reservas/${reservation.reservationRef}/cancelar`],
  });
  render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
};

const confirmButton = () =>
  screen.getByRole('button', { name: 'Confirmar cancelación' });

/**
 * La pantalla "Cancelar reserva" con `GET /api/reservations/{reservationRef}` (C3 de
 * `check-view-reservation`) y `POST /api/reservations/{reservationRef}/cancellation` (A de
 * `cancel-reservation`) simulados.
 */
describe('Pantalla "Cancelar reserva"', () => {
  beforeEach(() => {
    cancelAnswer = () => jsonResponse(RESULT);
    fetchMock.mockImplementation((_input, init) => {
      if (init?.method === 'POST') {
        return Promise.resolve(cancelAnswer());
      }
      // La última respuesta se repite: una `Response` solo se puede leer una vez.
      const answer =
        readAnswers.length > 1 ? readAnswers.shift() : readAnswers[0].clone();
      return Promise.resolve(answer as Response);
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  describe('la reserva a cancelar', () => {
    it('lee la reserva de la dirección y muestra con qué identificarla', async () => {
      renderCancel();

      expect(
        await screen.findByRole('heading', { name: 'Reserva a cancelar' }),
      ).toBeInTheDocument();
      expect(fetchMock.mock.calls[0][0]).toBe('/api/reservations/RSV-3F9A1C7B');
      const panel = screen.getByRole('heading', { name: 'Reserva a cancelar' })
        .parentElement as HTMLElement;
      expect(panel).toHaveTextContent('ReferenciaRSV-3F9A1C7B');
      expect(panel).toHaveTextContent('HuéspedValentina Ospina');
      expect(panel).toHaveTextContent(
        'Fechas (in → out)23/10/2026 → 25/10/2026',
      );
      expect(panel).toHaveTextContent('Noches2');
      expect(panel).toHaveTextContent('Personas3');
      expect(panel).toHaveTextContent('Habitaciones204 · DOBLE');
    });

    it('"← Volver al detalle" y "Volver sin cancelar" llevan al detalle, sin cancelar', async () => {
      renderCancel();

      await screen.findByRole('heading', { name: 'Confirmación' });
      for (const name of ['← Volver al detalle', 'Volver sin cancelar']) {
        expect(screen.getByRole('link', { name })).toHaveAttribute(
          'href',
          '/reservas/RSV-3F9A1C7B',
        );
      }
      expect(cancellationsSent()).toEqual([]);
    });
  });

  describe('la casilla de confirmación (FR-002b)', () => {
    it('sin marcar la casilla, el botón está deshabilitado y no se envía nada', async () => {
      const user = userEvent.setup();
      renderCancel();
      await screen.findByRole('heading', { name: 'Confirmación' });

      expect(screen.getByLabelText(CHECKBOX)).not.toBeChecked();
      expect(confirmButton()).toBeDisabled();
      await user.click(confirmButton());

      expect(cancellationsSent()).toEqual([]);
    });

    it('al marcarla se habilita el botón, y al desmarcarla se vuelve a deshabilitar', async () => {
      const user = userEvent.setup();
      renderCancel();
      await screen.findByRole('heading', { name: 'Confirmación' });

      await user.click(screen.getByLabelText(CHECKBOX));
      expect(confirmButton()).toBeEnabled();

      await user.click(screen.getByLabelText(CHECKBOX));
      expect(confirmButton()).toBeDisabled();
    });
  });

  describe('la cancelación (A)', () => {
    it('envía la solicitud del ejemplo de A: el updatedAt que leyó, acknowledged en true y el motivo', async () => {
      const user = userEvent.setup();
      renderCancel();
      await screen.findByRole('heading', { name: 'Confirmación' });

      await user.type(
        screen.getByLabelText('Motivo (opcional)'),
        '  El huésped cambió de planes ',
      );
      await user.click(screen.getByLabelText(CHECKBOX));
      await user.click(confirmButton());

      await screen.findByRole('status');
      const [sent] = cancellationsSent();
      expect(cancellationsSent()).toHaveLength(1);
      expect(sent.url).toBe('/api/reservations/RSV-3F9A1C7B/cancellation');
      expect(sent.body).toEqual({
        updatedAt: UPDATED_AT,
        acknowledged: true,
        reason: 'El huésped cambió de planes',
      });
      // El backend toma de X-User quién la procesa.
      expect(sent.headers).toMatchObject({
        'X-User': 'laura.mendez',
        'X-Client': 'RECEPTIONIST',
        'Content-Type': 'application/json',
      });
    });

    it('sin motivo no envía el campo reason: es opcional', async () => {
      const user = userEvent.setup();
      renderCancel();
      await screen.findByRole('heading', { name: 'Confirmación' });

      await user.type(screen.getByLabelText('Motivo (opcional)'), '   ');
      await user.click(screen.getByLabelText(CHECKBOX));
      await user.click(confirmButton());

      await screen.findByRole('status');
      expect(cancellationsSent()[0].body).toEqual({
        updatedAt: UPDATED_AT,
        acknowledged: true,
      });
    });

    it('el motivo admite como máximo 500 caracteres', async () => {
      renderCancel();

      await screen.findByRole('heading', { name: 'Confirmación' });
      expect(screen.getByLabelText('Motivo (opcional)')).toHaveAttribute(
        'maxlength',
        '500',
      );
    });

    it('cuando el backend confirma, lo dice y ofrece ver el detalle o volver a reservas; el formulario desaparece', async () => {
      const user = userEvent.setup();
      renderCancel();
      await screen.findByRole('heading', { name: 'Confirmación' });

      await user.click(screen.getByLabelText(CHECKBOX));
      await user.click(confirmButton());

      expect(await screen.findByRole('status')).toHaveTextContent(
        'La reserva RSV-3F9A1C7B quedó cancelada.',
      );
      expect(
        screen.getByRole('link', { name: 'Ver el detalle' }),
      ).toHaveAttribute('href', '/reservas/RSV-3F9A1C7B');
      expect(
        screen.getByRole('link', { name: 'Volver a reservas' }),
      ).toHaveAttribute('href', '/reservas');
      expect(
        screen.queryByRole('button', { name: 'Confirmar cancelación' }),
      ).not.toBeInTheDocument();
    });

    it('mientras el backend responde, el botón dice "Cancelando…" y no se puede enviar dos veces', async () => {
      const user = userEvent.setup();
      cancelAnswer = () => new Promise<Response>(() => undefined);
      renderCancel();
      await screen.findByRole('heading', { name: 'Confirmación' });

      await user.click(screen.getByLabelText(CHECKBOX));
      await user.click(confirmButton());

      const sending = await screen.findByRole('button', {
        name: 'Cancelando…',
      });
      expect(sending).toBeDisabled();
      await user.click(sending);
      expect(cancellationsSent()).toHaveLength(1);
    });
  });

  describe('los errores del backend (tabla C)', () => {
    it('CONCURRENT_UPDATE: muestra su mensaje y vuelve a leer la reserva, para enviar su updatedAt de ahora', async () => {
      const user = userEvent.setup();
      const NEWER = '2026-10-09T09:00:00.000000-05:00';
      cancelAnswer = () =>
        errorResponse('CONCURRENT_UPDATE', CONCURRENT_MESSAGE);
      renderCancel();
      await screen.findByRole('heading', { name: 'Confirmación' });
      // La segunda lectura trae la versión que dejó la otra persona.
      readAnswers = [jsonResponse({ ...RESERVATION, updatedAt: NEWER })];

      await user.click(screen.getByLabelText(CHECKBOX));
      await user.click(confirmButton());

      expect(await screen.findByRole('alert')).toHaveTextContent(
        CONCURRENT_MESSAGE,
      );
      await waitFor(() => expect(reads()).toBe(2));

      // El segundo intento va con el updatedAt nuevo.
      cancelAnswer = () => jsonResponse(RESULT);
      await user.click(confirmButton());

      await screen.findByRole('status');
      expect(cancellationsSent().map(({ body }) => body)).toEqual([
        { updatedAt: UPDATED_AT, acknowledged: true },
        { updatedAt: NEWER, acknowledged: true },
      ]);
    });

    it('si mientras tanto otra persona la canceló, el mensaje de la cancelación fallida sigue a la vista y el formulario desaparece', async () => {
      const user = userEvent.setup();
      cancelAnswer = () =>
        errorResponse('CONCURRENT_UPDATE', CONCURRENT_MESSAGE);
      renderCancel();
      await screen.findByRole('heading', { name: 'Confirmación' });
      readAnswers = [jsonResponse({ ...RESERVATION, status: 'CANCELLED' })];

      await user.click(screen.getByLabelText(CHECKBOX));
      await user.click(confirmButton());

      await waitFor(() =>
        expect(
          screen.queryByRole('button', { name: 'Confirmar cancelación' }),
        ).not.toBeInTheDocument(),
      );
      expect(
        screen.getAllByRole('alert').map((alert) => alert.textContent),
      ).toEqual([
        CONCURRENT_MESSAGE,
        'El estado actual de la reserva no admite cancelación.',
      ]);
    });

    it('cualquier otro error se muestra tal cual y el formulario sigue para reintentar', async () => {
      const user = userEvent.setup();
      cancelAnswer = () =>
        errorResponse(
          'REASON_TOO_LONG',
          'El motivo no puede superar 500 caracteres.',
        );
      renderCancel();
      await screen.findByRole('heading', { name: 'Confirmación' });

      await user.click(screen.getByLabelText(CHECKBOX));
      await user.click(confirmButton());

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'El motivo no puede superar 500 caracteres.',
      );
      await waitFor(() => expect(confirmButton()).toBeEnabled());
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
  });

  describe('reservas que no se pueden cancelar desde Recepción', () => {
    it('una reserva de OTA: muestra "La cancelación de una reserva de OTA debe llegar desde Booking." y ningún formulario', async () => {
      renderCancel({ ...RESERVATION, source: 'OTA' });

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'La cancelación de una reserva de OTA debe llegar desde Booking.',
      );
      expect(
        screen.queryByRole('button', { name: 'Confirmar cancelación' }),
      ).not.toBeInTheDocument();
      expect(screen.queryByLabelText(CHECKBOX)).not.toBeInTheDocument();
    });

    it.each(['IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW'] as const)(
      'una reserva directa %s: muestra "El estado actual de la reserva no admite cancelación." y ningún formulario',
      async (status) => {
        renderCancel({ ...RESERVATION, status });

        expect(await screen.findByRole('alert')).toHaveTextContent(
          'El estado actual de la reserva no admite cancelación.',
        );
        expect(
          screen.queryByRole('button', { name: 'Confirmar cancelación' }),
        ).not.toBeInTheDocument();
      },
    );

    it.each(['ACTIVE', 'PENDING'] as const)(
      'una reserva directa %s sí muestra el formulario',
      async (status) => {
        renderCancel({ ...RESERVATION, status });

        expect(
          await screen.findByRole('heading', { name: 'Confirmación' }),
        ).toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      },
    );
  });

  describe('los demás estados de la pantalla', () => {
    it('mientras lee la reserva muestra "Cargando reserva…" y ningún formulario', async () => {
      fetchMock.mockReturnValue(new Promise<Response>(() => undefined));
      signIn('laura.mendez');
      render(
        <QueryClientProvider client={createQueryClient()}>
          <RouterProvider
            router={createMemoryRouter(routes, {
              initialEntries: ['/reservas/RSV-3F9A1C7B/cancelar'],
            })}
          />
        </QueryClientProvider>,
      );

      expect(await screen.findByText('Cargando reserva…')).toBeInTheDocument();
      expect(screen.queryByLabelText(CHECKBOX)).not.toBeInTheDocument();
    });

    it('si la reserva no existe, muestra "La reserva no existe." y ningún formulario', async () => {
      renderCancel(
        RESERVATION,
        jsonResponse(
          {
            errorCode: 'RESERVATION_NOT_FOUND',
            message: 'La reserva no existe.',
            timestamp: '2026-10-09T13:00:00.000Z',
            path: '/api/reservations/RSV-3F9A1C7B',
          },
          400,
        ),
      );

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'La reserva no existe.',
      );
      expect(screen.queryByLabelText(CHECKBOX)).not.toBeInTheDocument();
    });
  });
});
