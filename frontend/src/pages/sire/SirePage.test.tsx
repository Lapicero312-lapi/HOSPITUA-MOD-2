import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../../routes.tsx';
import { createQueryClient } from '../../services/query-client.ts';
import { saveFile } from '../../services/save-file.ts';
import { signIn } from '../../services/session.ts';
import type {
  SireMovementItem,
  SireMovementPage,
  SireMovementPreview,
} from '../../services/sire.ts';

vi.mock('../../services/save-file.ts', () => ({ saveFile: vi.fn() }));

const OCTOBER = '/sire?startDate=2026-10-01&endDate=2026-10-31';
const NO_MOVEMENTS =
  'No hay movimientos migratorios que reportar en ese periodo.';
const EXPORT_ID = '3f9a1c7b-7d1a-4c0b-9d5e-2f4f3b6a1c11';

/** John, del ejemplo de B del plan, con su entrada y su salida. */
const JOHN_ENTRY: SireMovementItem = {
  movementId: '4b6c1f0e-2d3a-4e5f-8a9b-0c1d2e3f4a5b',
  reservationRef: 'RSV-3F9A1C7B',
  guest: {
    fullName: 'John Smith',
    documentType: 'PAS',
    documentNumber: 'X99',
    nationality: 'Estados Unidos',
  },
  movementType: 'ENTRY',
  movementDate: '2026-10-09',
};
const JOHN_DEPARTURE: SireMovementItem = {
  ...JOHN_ENTRY,
  movementId: 'c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f',
  movementType: 'DEPARTURE',
  movementDate: '2026-10-12',
};

/** La línea del ejemplo de C del plan. */
const JOHN_LINE =
  '123456\t11001\tPAS\tX99\tEstados Unidos\tSMITH\tJOHN\tE\t09/10/2026\tMiami, Estados Unidos\tCartagena, Colombia\t12/05/1990';
const FIELD_NAMES = [
  'Código del hotel',
  'Código de la ciudad',
  'Tipo de documento',
  'Número de documento',
  'Nacionalidad',
  'Apellidos',
  'Nombres',
  'Tipo de movimiento',
  'Fecha del movimiento',
  'Lugar de procedencia',
  'Lugar de destino',
  'Fecha de nacimiento',
];
const JOHN_PREVIEW: SireMovementPreview = {
  movementId: JOHN_ENTRY.movementId,
  reservationRef: 'RSV-3F9A1C7B',
  fields: JOHN_LINE.split('\t').map((value, index) => ({
    position: index + 1,
    name: FIELD_NAMES[index],
    value,
  })),
  line: JOHN_LINE,
};

const fetchMock = vi.fn<typeof fetch>();

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const pageOf = (
  items: SireMovementItem[],
  changes: Partial<SireMovementPage> = {},
): SireMovementPage => ({
  items,
  page: 1,
  pageSize: 50,
  totalItems: items.length,
  totalPages: items.length === 0 ? 0 : 1,
  message: items.length === 0 ? NO_MOVEMENTS : null,
  ...changes,
});

const errorResponse = (errorCode: string, message: string, status = 400) =>
  jsonResponse(
    {
      errorCode,
      message,
      timestamp: '2026-10-11T15:00:00.000Z',
      path: '/api/sire/exports',
    },
    status,
  );

/** El archivo de A: las líneas con CRLF y las cabeceras de la exportación. */
const fileResponse = (lines: number) =>
  new Response(
    Array.from({ length: lines }, () => `${JOHN_LINE}\r\n`).join(''),
    {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Export-Id': EXPORT_ID,
        'Content-Disposition': `attachment; filename="SIRE_${EXPORT_ID}.txt"`,
      },
    },
  );

/**
 * Responde según la ruta: el listado, la vista previa y la exportación. `exportResponse` se usa en cada
 * `POST /api/sire/exports`.
 */
function backend(options: {
  list?: () => Response;
  preview?: () => Response;
  exportResponse?: () => Response | Promise<Response>;
}) {
  fetchMock.mockImplementation((input, init) => {
    const url = String(input);
    if (url.startsWith('/api/sire/movements?')) {
      return Promise.resolve(
        options.list?.() ?? jsonResponse(pageOf([JOHN_ENTRY, JOHN_DEPARTURE])),
      );
    }
    if (url.endsWith('/preview')) {
      return Promise.resolve(options.preview?.() ?? jsonResponse(JOHN_PREVIEW));
    }
    if (url === '/api/sire/exports' && init?.method === 'POST') {
      return Promise.resolve(options.exportResponse?.() ?? fileResponse(2));
    }
    return Promise.reject(new Error(`Ruta no esperada: ${url}`));
  });
}

/** Las llamadas a una ruta, con su método y su cuerpo. */
const callsTo = (prefix: string) =>
  fetchMock.mock.calls
    .filter(([input]) => String(input).startsWith(prefix))
    .map(([input, init]) => ({
      url: String(input),
      method: init?.method,
      body:
        init?.body === undefined ? undefined : JSON.parse(String(init.body)),
      headers: init?.headers as Record<string, string>,
    }));

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

/** El texto de cada celda de la tabla de movimientos, fila por fila. */
const movementRows = () =>
  within(screen.getByRole('table'))
    .getAllByRole('row')
    .slice(1)
    .map((row) =>
      within(row)
        .getAllByRole('cell')
        .slice(0, 4)
        .map((cell) => cell.textContent),
    );

const downloadAll = () =>
  screen.getByRole('button', { name: 'Descargar todo el periodo (.TXT)' });

/**
 * La pantalla "Exportar SIRE" (spec de `export-sire-file`, historia 1 y FR-010) con A, B y C del plan
 * simulados.
 */
describe('Pantalla "Exportar SIRE"', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.mocked(saveFile).mockReset();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  describe('el periodo', () => {
    it('sin las dos fechas no consulta: pide el periodo y no deja descargar', async () => {
      backend({});
      renderAt('/sire?startDate=2026-10-01');

      expect(
        await screen.findByText(
          'Elija la fecha inicial y la final para ver los movimientos del periodo.',
        ),
      ).toBeInTheDocument();
      expect(screen.getByLabelText('Fecha inicial')).toHaveValue('2026-10-01');
      expect(downloadAll()).toBeDisabled();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('con las dos fechas consulta el periodo desde la página 1 y lo guarda en la dirección', async () => {
      backend({});
      const router = renderAt('/sire');

      await userEvent.type(
        screen.getByLabelText('Fecha inicial'),
        '2026-10-01',
      );
      await userEvent.type(screen.getByLabelText('Fecha final'), '2026-10-31');

      expect(await screen.findByRole('table')).toBeInTheDocument();
      expect(callsTo('/api/sire/movements')).toEqual([
        expect.objectContaining({
          url: '/api/sire/movements?startDate=2026-10-01&endDate=2026-10-31&page=1',
          method: 'GET',
        }),
      ]);
      expect(router.state.location.search).toBe(
        '?startDate=2026-10-01&endDate=2026-10-31',
      );
    });

    it.each([
      ['Últimos 7 días', '2026-10-08'],
      ['Últimos 30 días', '2026-09-15'],
    ])(
      '"%s" va de hoy menos esos días a hoy, como el wireframe',
      async (shortcut, startDate) => {
        vi.useFakeTimers({ toFake: ['Date'] });
        // Las 10:00 del 15 de octubre en Colombia.
        vi.setSystemTime(new Date('2026-10-15T15:00:00.000Z'));
        backend({});
        renderAt('/sire');

        await userEvent.click(screen.getByRole('button', { name: shortcut }));

        expect(screen.getByLabelText('Fecha inicial')).toHaveValue(startDate);
        expect(screen.getByLabelText('Fecha final')).toHaveValue('2026-10-15');
        await screen.findByRole('table');
      },
    );

    it('"hoy" es el día en Colombia, aunque en UTC ya sea el día siguiente', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      // Las 22:00 del 15 de octubre en Colombia son las 03:00 del 16 en UTC.
      vi.setSystemTime(new Date('2026-10-16T03:00:00.000Z'));
      backend({});
      renderAt('/sire');

      await userEvent.click(
        screen.getByRole('button', { name: 'Últimos 7 días' }),
      );

      expect(screen.getByLabelText('Fecha final')).toHaveValue('2026-10-15');
      expect(screen.getByLabelText('Fecha inicial')).toHaveValue('2026-10-08');
    });

    it('un periodo que el backend rechaza muestra su mensaje tal cual y no deja descargar', async () => {
      backend({
        list: () =>
          errorResponse(
            'INVALID_DATE_RANGE',
            'La fecha inicial no puede ser posterior a la fecha final.',
          ),
      });
      renderAt('/sire?startDate=2026-10-31&endDate=2026-10-01');

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'La fecha inicial no puede ser posterior a la fecha final.',
      );
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
      expect(downloadAll()).toBeDisabled();
    });
  });

  describe('los movimientos del periodo', () => {
    it('muestra cada movimiento con la reserva, el huésped y su documento, la nacionalidad y el movimiento con su fecha', async () => {
      backend({});
      renderAt(OCTOBER);

      await screen.findByRole('table');
      expect(
        screen.getAllByRole('columnheader').map((header) => header.textContent),
      ).toEqual([
        'Reserva',
        'Huésped',
        'Nacionalidad',
        'Movimiento',
        'Acciones',
      ]);
      expect(movementRows()).toEqual([
        [
          'RSV-3F9A1C7B',
          'John SmithPAS X99',
          'Estados Unidos',
          'Entrada09/10/2026',
        ],
        [
          'RSV-3F9A1C7B',
          'John SmithPAS X99',
          'Estados Unidos',
          'Salida12/10/2026',
        ],
      ]);
      expect(screen.getByText('2 movimientos')).toBeInTheDocument();
      expect(screen.getByText('Página 1 de 1')).toBeInTheDocument();
      expect(downloadAll()).toBeEnabled();
    });

    it('un periodo sin extranjeros muestra el mensaje del backend y no deja descargar (listar no es un error)', async () => {
      backend({ list: () => jsonResponse(pageOf([])) });
      renderAt(OCTOBER);

      expect(await screen.findByText(NO_MOVEMENTS)).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(downloadAll()).toBeDisabled();
    });

    it('pagina de a 50: "Siguiente" pide la página 2 con el mismo periodo', async () => {
      backend({
        list: () =>
          jsonResponse(pageOf([JOHN_ENTRY], { totalItems: 51, totalPages: 2 })),
      });
      const router = renderAt(OCTOBER);

      await screen.findByRole('table');
      expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();
      await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }));

      await waitFor(() =>
        expect(callsTo('/api/sire/movements').at(-1)?.url).toBe(
          '/api/sire/movements?startDate=2026-10-01&endDate=2026-10-31&page=2',
        ),
      );
      expect(router.state.location.search).toContain('page=2');
    });

    it('cambiar una fecha vuelve a la página 1, con el periodo nuevo', async () => {
      backend({
        list: () =>
          jsonResponse(
            pageOf([JOHN_ENTRY], { page: 2, totalItems: 51, totalPages: 2 }),
          ),
      });
      const router = renderAt(`${OCTOBER}&page=2`);
      await screen.findByRole('table');

      const start = screen.getByLabelText('Fecha inicial');
      await userEvent.clear(start);
      await userEvent.type(start, '2026-10-02');

      expect(router.state.location.search).toBe(
        '?startDate=2026-10-02&endDate=2026-10-31',
      );
      await waitFor(() =>
        expect(callsTo('/api/sire/movements').at(-1)?.url).toBe(
          '/api/sire/movements?startDate=2026-10-02&endDate=2026-10-31&page=1',
        ),
      );
    });

    it('mientras responde muestra "Cargando movimientos…"', async () => {
      fetchMock.mockReturnValue(new Promise<Response>(() => undefined));
      renderAt(OCTOBER);

      expect(
        await screen.findByText('Cargando movimientos…'),
      ).toBeInTheDocument();
    });
  });

  describe('las descargas', () => {
    it('"Descargar todo el periodo" exporta el periodo a nombre de la Recepcionista, guarda el archivo tal cual y dice cuántos movimientos trae', async () => {
      backend({});
      renderAt(OCTOBER);
      await screen.findByRole('table');

      await userEvent.click(downloadAll());

      expect(await screen.findByRole('status')).toHaveTextContent(
        `Archivo SIRE_${EXPORT_ID}.txt descargado: 2 movimientos.`,
      );
      const [exportCall] = callsTo('/api/sire/exports');
      expect(exportCall).toMatchObject({
        method: 'POST',
        body: {
          exportKind: 'PERIOD',
          startDate: '2026-10-01',
          endDate: '2026-10-31',
        },
      });
      expect(exportCall.headers).toMatchObject({ 'X-User': 'Laura Méndez' });
      expect(saveFile).toHaveBeenCalledOnce();
      const [file, fileName] = vi.mocked(saveFile).mock.calls[0];
      expect(fileName).toBe(`SIRE_${EXPORT_ID}.txt`);
      expect(await file.text()).toBe(`${JOHN_LINE}\r\n${JOHN_LINE}\r\n`);
    });

    it('"Descargar" de una fila exporta solo ese movimiento', async () => {
      backend({ exportResponse: () => fileResponse(1) });
      renderAt(OCTOBER);
      await screen.findByRole('table');

      await userEvent.click(
        screen.getByRole('button', { name: 'Descargar salida de John Smith' }),
      );

      expect(await screen.findByRole('status')).toHaveTextContent(
        `Movimiento de John Smith descargado (SIRE_${EXPORT_ID}.txt).`,
      );
      expect(callsTo('/api/sire/exports')).toEqual([
        expect.objectContaining({
          body: {
            exportKind: 'SINGLE_MOVEMENT',
            movementId: JOHN_DEPARTURE.movementId,
          },
        }),
      ]);
      expect(saveFile).toHaveBeenCalledOnce();
    });

    it('mientras descarga no deja volver a descargar', async () => {
      let answer: (response: Response) => void = () => undefined;
      backend({
        exportResponse: () =>
          new Promise<Response>((resolve) => {
            answer = resolve;
          }),
      });
      renderAt(OCTOBER);
      await screen.findByRole('table');

      await userEvent.click(downloadAll());

      expect(downloadAll()).toBeDisabled();
      expect(
        screen.getByRole('button', { name: 'Descargar entrada de John Smith' }),
      ).toBeDisabled();
      answer(fileResponse(2));
      expect(await screen.findByRole('status')).toBeInTheDocument();
      expect(callsTo('/api/sire/exports')).toHaveLength(1);
    });

    it.each([
      [
        'INVALID_GUEST_CHARACTERS',
        'Caracteres no válidos en el registro del huésped.',
        400,
      ],
      [
        'TOO_MANY_REQUESTS',
        'Se superó el límite de solicitudes de exportación. Intente de nuevo en unos segundos.',
        429,
      ],
    ])(
      'si el backend rechaza la exportación (%s) muestra su mensaje y no guarda nada',
      async (errorCode, message, status) => {
        backend({
          exportResponse: () => errorResponse(errorCode, message, status),
        });
        renderAt(OCTOBER);
        await screen.findByRole('table');

        await userEvent.click(downloadAll());

        expect(await screen.findByRole('alert')).toHaveTextContent(message);
        expect(saveFile).not.toHaveBeenCalled();
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
      },
    );
  });

  describe('la vista previa', () => {
    it('muestra los 12 campos y la línea con el separador como →, sin registrar nada', async () => {
      backend({});
      renderAt(OCTOBER);
      await screen.findByRole('table');

      await userEvent.click(
        screen.getByRole('button', {
          name: 'Previsualizar entrada de John Smith',
        }),
      );

      const dialog = await screen.findByRole('dialog', {
        name: 'Previsualizar movimiento',
      });
      const fields = await within(dialog).findByRole('table', {
        name: 'Campos SIRE',
      });
      expect(
        within(fields)
          .getAllByRole('row')
          .slice(1)
          .map((row) =>
            within(row)
              .getAllByRole('cell')
              .map((cell) => cell.textContent),
          ),
      ).toEqual(
        JOHN_PREVIEW.fields.map(({ position, name, value }) => [
          String(position),
          name,
          value,
        ]),
      );
      expect(
        within(dialog).getByText(/^123456 → 11001 → PAS → X99/),
      ).toHaveTextContent(JOHN_LINE.split('\t').join(' → '));
      expect(
        within(dialog).getByText('Entrada · 09/10/2026'),
      ).toBeInTheDocument();
      expect(callsTo('/api/sire/movements/')).toEqual([
        expect.objectContaining({
          url: `/api/sire/movements/${JOHN_ENTRY.movementId}/preview`,
          method: 'GET',
        }),
      ]);
      expect(callsTo('/api/sire/exports')).toEqual([]);
    });

    it('"Descargar este movimiento" lo exporta y cierra la vista previa', async () => {
      backend({ exportResponse: () => fileResponse(1) });
      renderAt(OCTOBER);
      await screen.findByRole('table');
      await userEvent.click(
        screen.getByRole('button', {
          name: 'Previsualizar entrada de John Smith',
        }),
      );
      const dialog = await screen.findByRole('dialog');
      await within(dialog).findByRole('table', { name: 'Campos SIRE' });

      await userEvent.click(
        within(dialog).getByRole('button', {
          name: 'Descargar este movimiento (.TXT)',
        }),
      );

      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );
      expect(screen.getByRole('status')).toHaveTextContent(
        `Movimiento de John Smith descargado (SIRE_${EXPORT_ID}.txt).`,
      );
      expect(callsTo('/api/sire/exports')[0].body).toEqual({
        exportKind: 'SINGLE_MOVEMENT',
        movementId: JOHN_ENTRY.movementId,
      });
    });

    it('"Cerrar" y la tecla Escape la cierran', async () => {
      backend({});
      renderAt(OCTOBER);
      await screen.findByRole('table');
      const open = () =>
        userEvent.click(
          screen.getByRole('button', {
            name: 'Previsualizar entrada de John Smith',
          }),
        );

      await open();
      await userEvent.click(
        within(await screen.findByRole('dialog')).getByRole('button', {
          name: 'Cerrar',
        }),
      );
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      await open();
      await screen.findByRole('dialog');
      await userEvent.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('si el movimiento no se puede escribir (INVALID_GUEST_CHARACTERS) muestra el mensaje y no deja descargarlo', async () => {
      backend({
        preview: () =>
          errorResponse(
            'INVALID_GUEST_CHARACTERS',
            'Caracteres no válidos en el registro del huésped.',
          ),
      });
      renderAt(OCTOBER);
      await screen.findByRole('table');

      await userEvent.click(
        screen.getByRole('button', {
          name: 'Previsualizar entrada de John Smith',
        }),
      );

      const dialog = await screen.findByRole('dialog');
      expect(await within(dialog).findByRole('alert')).toHaveTextContent(
        'Caracteres no válidos en el registro del huésped.',
      );
      expect(
        within(dialog).getByRole('button', {
          name: 'Descargar este movimiento (.TXT)',
        }),
      ).toBeDisabled();
    });
  });

  describe('la navegación', () => {
    it('el menú tiene "Exportar SIRE" y lleva a la pantalla', async () => {
      backend({});
      const router = renderAt('/');

      await userEvent.click(
        within(screen.getByRole('navigation', { name: 'Principal' })).getByRole(
          'link',
          { name: 'Exportar SIRE' },
        ),
      );

      expect(router.state.location.pathname).toBe('/sire');
      expect(
        screen.getByRole('heading', { name: 'Exportar archivo SIRE' }),
      ).toBeInTheDocument();
    });

    it('el inicio tiene el acceso a la pantalla', async () => {
      backend({});
      const router = renderAt('/');

      await userEvent.click(
        within(screen.getByRole('main')).getByRole('link', {
          name: 'Exportar SIRE',
        }),
      );

      expect(router.state.location.pathname).toBe('/sire');
    });
  });
});
