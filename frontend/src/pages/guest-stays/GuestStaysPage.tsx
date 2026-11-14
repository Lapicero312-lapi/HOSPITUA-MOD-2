import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ErrorMessage } from '../../components/ErrorMessage.tsx';
import {
  getGuestStayDetail,
  listGuestStays,
  type GuestStay,
  type GuestStayFilters,
  type GuestStayPage,
  type MovementType,
  type NationalityFilter,
  type PresenceFilter,
} from '../../services/guest-stays.ts';
import './GuestStaysPage.css';

/** Lo que se muestra en un dato vacío (historia 3, escenario 6). */
const EMPTY = '—';

/** El mensaje del listado vacío (escenario 7), por si el backend no lo envía. */
const NO_GUEST_STAYS = 'No hay huéspedes que coincidan con los filtros.';

const MOVEMENT_LABELS: Record<MovementType, string> = {
  ENTRY: 'Entrada',
  DEPARTURE: 'Salida',
};

const NATIONALITIES: NationalityFilter[] = ['FOREIGN', 'COLOMBIAN'];
const PRESENCES: PresenceFilter[] = ['IN_HOTEL', 'CHECKED_OUT'];

/**
 * Los filtros viven en la dirección de la pantalla (`?nationality=FOREIGN&page=2`): así se conservan al
 * cambiar de página, al volver del detalle de una reserva y al recargar. Vacío es "Todos".
 */
type ScreenFilters = {
  search: string;
  nationality: NationalityFilter | '';
  presence: PresenceFilter | '';
  dateFrom: string;
  dateTo: string;
  page: number;
};

/** El huésped cuyo detalle está abierto: un `GuestData` es único por reserva y documento. */
type GuestKey = { reservationRef: string; documentNumber: string };

function readFilters(params: URLSearchParams): ScreenFilters {
  const nationality = params.get('nationality') ?? '';
  const presence = params.get('presence') ?? '';
  const page = Number(params.get('page') ?? '1');
  return {
    search: params.get('search') ?? '',
    nationality: NATIONALITIES.includes(nationality as NationalityFilter)
      ? (nationality as NationalityFilter)
      : '',
    presence: PRESENCES.includes(presence as PresenceFilter)
      ? (presence as PresenceFilter)
      : '',
    dateFrom: params.get('dateFrom') ?? '',
    dateTo: params.get('dateTo') ?? '',
    page: Number.isInteger(page) && page >= 1 ? page : 1,
  };
}

/** Los filtros como parámetros de la dirección, sin los que tienen su valor por defecto. */
function toParams(filters: ScreenFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.search !== '') params.set('search', filters.search);
  if (filters.nationality !== '') {
    params.set('nationality', filters.nationality);
  }
  if (filters.presence !== '') params.set('presence', filters.presence);
  if (filters.dateFrom !== '') params.set('dateFrom', filters.dateFrom);
  if (filters.dateTo !== '') params.set('dateTo', filters.dateTo);
  if (filters.page > 1) params.set('page', String(filters.page));
  return params;
}

/**
 * Lo que se le pide al backend (C1): solo los filtros indicados. Las fechas se envían tal cual, aunque
 * falte una: el backend revisa el rango y la pantalla muestra su mensaje (escenario 8).
 */
function toRequest(filters: ScreenFilters): GuestStayFilters {
  return {
    search: filters.search === '' ? undefined : filters.search,
    nationality: filters.nationality === '' ? undefined : filters.nationality,
    presence: filters.presence === '' ? undefined : filters.presence,
    dateFrom: filters.dateFrom === '' ? undefined : filters.dateFrom,
    dateTo: filters.dateTo === '' ? undefined : filters.dateTo,
    page: filters.page > 1 ? filters.page : undefined,
  };
}

/**
 * Pantalla "Huéspedes alojados" (spec de `process-guest-data`, historia 3; plan, C1 y C2): la búsqueda,
 * los filtros, el listado de a 10 con su paginación y el detalle de un huésped. Es solo de consulta. Las
 * validaciones las hace el backend: su mensaje se muestra tal cual.
 */
export function GuestStaysPage() {
  const [params, setParams] = useSearchParams();
  const filters = readFilters(params);
  const [selected, setSelected] = useState<GuestKey | null>(null);

  /** Cambia filtros y vuelve a la página 1; solo la paginación conserva la página. */
  const change = (changes: Partial<ScreenFilters>) => {
    setParams(toParams({ ...filters, page: 1, ...changes }));
  };

  return (
    <section className="guest-stays ui-page">
      <header className="ui-page-header">
        <div>
          <h1 className="guest-stays-title ui-page-title">
            Huéspedes alojados
          </h1>
          <p className="ui-page-subtitle">
            Quién se aloja en el hotel, con su entrada, salida y detalle.
          </p>
        </div>
      </header>
      <Filters key={filters.search} filters={filters} onChange={change} />
      <div className="guest-stays-panel ui-panel">
        <Results
          filters={filters}
          onPage={(page) => change({ page })}
          onOpen={setSelected}
        />
      </div>
      {selected !== null && (
        <GuestDialog guest={selected} onClose={() => setSelected(null)} />
      )}
    </section>
  );
}

function Filters({
  filters,
  onChange,
}: {
  filters: ScreenFilters;
  onChange: (changes: Partial<ScreenFilters>) => void;
}) {
  // El texto de la búsqueda se aplica al enviar el formulario, no con cada tecla. Si la búsqueda cambia
  // por otra vía (el botón de retroceso), el formulario se vuelve a crear con ese texto (`key`).
  const [search, setSearch] = useState(filters.search);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onChange({ search: search.trim() });
  };

  const clear = () => {
    setSearch('');
    onChange({
      search: '',
      nationality: '',
      presence: '',
      dateFrom: '',
      dateTo: '',
    });
  };

  return (
    <form
      className="guest-stays-filters ui-panel ui-toolbar"
      aria-label="Filtros"
      onSubmit={submit}
      noValidate
    >
      <div className="guest-stays-field guest-stays-field--search ui-field">
        <label htmlFor="guest-stays-search">Buscar</label>
        <div className="guest-stays-search">
          <input
            id="guest-stays-search"
            type="search"
            value={search}
            maxLength={40}
            placeholder="Número de documento o nombre"
            onChange={(event) => setSearch(event.target.value)}
          />
          <button type="submit">Buscar</button>
        </div>
      </div>
      <div className="guest-stays-field ui-field">
        <label htmlFor="guest-stays-nationality">Nacionalidad</label>
        <select
          id="guest-stays-nationality"
          value={filters.nationality}
          onChange={(event) =>
            onChange({
              nationality: event.target.value as NationalityFilter | '',
            })
          }
        >
          <option value="">Todos</option>
          <option value="FOREIGN">Extranjeros</option>
          <option value="COLOMBIAN">Colombianos</option>
        </select>
      </div>
      <div className="guest-stays-field ui-field">
        <label htmlFor="guest-stays-presence">Situación</label>
        <select
          id="guest-stays-presence"
          value={filters.presence}
          onChange={(event) =>
            onChange({ presence: event.target.value as PresenceFilter | '' })
          }
        >
          <option value="">Todos</option>
          <option value="IN_HOTEL">En el hotel</option>
          <option value="CHECKED_OUT">Ya salió</option>
        </select>
      </div>
      <div className="guest-stays-field ui-field">
        <label htmlFor="guest-stays-from">Desde</label>
        <input
          id="guest-stays-from"
          type="date"
          value={filters.dateFrom}
          onChange={(event) => onChange({ dateFrom: event.target.value })}
        />
      </div>
      <div className="guest-stays-field ui-field">
        <label htmlFor="guest-stays-to">Hasta</label>
        <input
          id="guest-stays-to"
          type="date"
          value={filters.dateTo}
          onChange={(event) => onChange({ dateTo: event.target.value })}
        />
      </div>
      <button
        type="button"
        className="guest-stays-clear ui-button--ghost"
        onClick={clear}
      >
        Limpiar filtros
      </button>
    </form>
  );
}

function Results({
  filters,
  onPage,
  onOpen,
}: {
  filters: ScreenFilters;
  onPage: (page: number) => void;
  onOpen: (guest: GuestKey) => void;
}) {
  const request = toRequest(filters);
  const stays = useQuery({
    queryKey: ['guest-stays', 'list', request],
    queryFn: ({ signal }) => listGuestStays(request, signal),
  });

  if (stays.isPending) {
    return (
      <p className="guest-stays-state guest-stays-state--loading ui-state ui-state--loading">
        Cargando huéspedes…
      </p>
    );
  }
  if (stays.isError) {
    return <ErrorMessage error={stays.error} />;
  }
  if (stays.data.items.length === 0) {
    return (
      <p className="guest-stays-state ui-state">
        {stays.data.message ?? NO_GUEST_STAYS}
      </p>
    );
  }
  return (
    <>
      <GuestStaysTable stays={stays.data.items} onOpen={onOpen} />
      <Pagination list={stays.data} onPage={onPage} />
    </>
  );
}

function GuestStaysTable({
  stays,
  onOpen,
}: {
  stays: GuestStay[];
  onOpen: (guest: GuestKey) => void;
}) {
  return (
    <div className="ui-scroll-x">
      <table
        className="guest-stays-table ui-table ui-table--sticky"
        aria-label="Huéspedes alojados"
      >
        <thead>
          <tr>
            <th scope="col">Huésped</th>
            <th scope="col">Nacionalidad</th>
            <th scope="col">Reserva</th>
            <th scope="col">Entrada</th>
            <th scope="col">Salida</th>
            <th scope="col">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {stays.map((stay) => (
            <GuestStayRow
              key={`${stay.reservationRef}/${stay.guest.documentNumber}`}
              stay={stay}
              onOpen={onOpen}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GuestStayRow({
  stay,
  onOpen,
}: {
  stay: GuestStay;
  onOpen: (guest: GuestKey) => void;
}) {
  const { guest, reservationRef } = stay;
  const name = `${orEmpty(guest.firstName)} ${orEmpty(guest.lastName)}`;
  return (
    <tr>
      <td>
        <span className="guest-stays-name">{name}</span>
        <span className="guest-stays-secondary ui-secondary">
          {guest.documentType} {guest.documentNumber}
        </span>
      </td>
      <td>
        {orEmpty(guest.nationality)}
        {guest.isForeign && (
          <span className="guest-stays-badge guest-stays-badge--foreign ui-badge ui-badge--plain tone-info">
            Extranjero
          </span>
        )}
      </td>
      <td>
        <Link
          to={`/reservas/${reservationRef}`}
          className="guest-stays-ref"
          aria-label={`Ver reserva ${reservationRef}`}
        >
          {reservationRef}
        </Link>
      </td>
      <td className="guest-stays-date">
        {stay.entryDate === null ? EMPTY : formatDate(stay.entryDate)}
      </td>
      <td className="guest-stays-date">
        {stay.inHotel ? (
          <span className="guest-stays-badge guest-stays-badge--in-hotel ui-badge tone-positive">
            En el hotel
          </span>
        ) : stay.exitDate === null ? (
          EMPTY
        ) : (
          formatDate(stay.exitDate)
        )}
      </td>
      <td>
        <button
          type="button"
          className="guest-stays-action"
          aria-label={`Ver detalle de ${name}`}
          onClick={() =>
            onOpen({ reservationRef, documentNumber: guest.documentNumber })
          }
        >
          Ver detalle
        </button>
      </td>
    </tr>
  );
}

/** "Mostrando 1–10 de 23 huéspedes · página 1 de 3", con Anterior, los números y Siguiente (wireframe). */
function Pagination({
  list,
  onPage,
}: {
  list: GuestStayPage;
  onPage: (page: number) => void;
}) {
  const from = (list.page - 1) * list.pageSize + 1;
  const to = from + list.items.length - 1;
  const pages = pageWindow(list.page, list.totalPages);
  return (
    <nav
      className="guest-stays-pagination ui-pagination"
      aria-label="Paginación"
    >
      <span>
        Mostrando {from}–{to} de {list.totalItems}{' '}
        {list.totalItems === 1 ? 'huésped' : 'huéspedes'} · página {list.page}{' '}
        de {list.totalPages}
      </span>
      <span className="guest-stays-pages">
        <button
          type="button"
          disabled={list.page <= 1}
          onClick={() => onPage(list.page - 1)}
        >
          ← Anterior
        </button>
        {pages.map((page, index) =>
          page === null ? (
            // Un salto entre números: no hay otra clave estable que su posición.
            <span key={`gap-${index}`} className="guest-stays-gap">
              …
            </span>
          ) : (
            <button
              key={page}
              type="button"
              className={page === list.page ? 'guest-stays-current' : undefined}
              aria-current={page === list.page ? 'page' : undefined}
              aria-label={`Página ${page}`}
              onClick={() => onPage(page)}
            >
              {page}
            </button>
          ),
        )}
        <button
          type="button"
          disabled={list.page >= list.totalPages}
          onClick={() => onPage(list.page + 1)}
        >
          Siguiente →
        </button>
      </span>
    </nav>
  );
}

/** Cuántas páginas se muestran a cada lado de la actual. */
const PAGE_WINDOW = 2;

/**
 * Los números de página que se muestran: la primera, la última y las vecinas de la actual; `null` marca un
 * salto. Con 50 000 movimientos (NFR-003) hay miles de páginas y no caben todas.
 */
function pageWindow(page: number, totalPages: number): (number | null)[] {
  const pages: (number | null)[] = [];
  for (let current = 1; current <= totalPages; current++) {
    const near = Math.abs(current - page) <= PAGE_WINDOW;
    if (current === 1 || current === totalPages || near) {
      pages.push(current);
    } else if (pages[pages.length - 1] !== null) {
      pages.push(null);
    }
  }
  return pages;
}

/**
 * El detalle de un huésped (C2, escenario 6): sus datos, con una raya en lo vacío, sus movimientos y el
 * enlace a la reserva. Solo de consulta.
 */
function GuestDialog({
  guest,
  onClose,
}: {
  guest: GuestKey;
  onClose: () => void;
}) {
  const titleId = useId();
  const detail = useQuery({
    queryKey: [
      'guest-stays',
      'detail',
      guest.reservationRef,
      guest.documentNumber,
    ],
    queryFn: ({ signal }) =>
      getGuestStayDetail(guest.reservationRef, guest.documentNumber, signal),
  });

  // Escape cierra el detalle, como cualquier ventana.
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [onClose]);

  const data = detail.data;
  const title =
    data === undefined
      ? 'Detalle del huésped'
      : `${orEmpty(data.guest.firstName)} ${orEmpty(data.guest.lastName)}`;

  return (
    <div className="guest-stays-backdrop" onMouseDown={onClose}>
      <div
        className="guest-stays-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="guest-stays-dialog-header">
          <h2 id={titleId} className="guest-stays-subtitle">
            {title}
          </h2>
          <kbd>ESC</kbd>
        </header>
        <div className="guest-stays-dialog-body">
          {detail.isPending && (
            <p className="guest-stays-state guest-stays-state--loading ui-state ui-state--loading">
              Cargando el huésped…
            </p>
          )}
          {detail.isError && <ErrorMessage error={detail.error} />}
          {data !== undefined && (
            <>
              <dl className="guest-stays-data">
                <Datum
                  label="Documento"
                  value={`${data.guest.documentType} ${data.guest.documentNumber}`}
                />
                <Datum
                  label="Fecha de nacimiento"
                  value={formatDate(data.guest.birthDate)}
                />
                <Datum
                  label="Nacionalidad"
                  value={
                    data.guest.nationality === null
                      ? null
                      : `${data.guest.nationality}${data.guest.isForeign ? ' · extranjero' : ''}`
                  }
                />
                <Datum label="Reserva" value={data.reservationRef} />
                <Datum
                  label="Lugar de procedencia"
                  value={data.guest.originPlace}
                />
                <Datum
                  label="Lugar de destino"
                  value={data.guest.destinationPlace}
                />
              </dl>
              <div className="guest-stays-movements">
                <table
                  className="guest-stays-table ui-table"
                  aria-label="Movimientos"
                >
                  <thead>
                    <tr>
                      <th scope="col">Movimiento</th>
                      <th scope="col">Fecha</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.movements.map((movement) => (
                      <tr key={movement.movementType}>
                        <td>
                          <span className="guest-stays-badge ui-badge">
                            {MOVEMENT_LABELS[movement.movementType]}
                          </span>
                        </td>
                        <td className="guest-stays-date">
                          {formatDate(movement.movementDate)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
        <div className="guest-stays-dialog-actions">
          <button type="button" onClick={onClose}>
            Cerrar
          </button>
          {data !== undefined && (
            <Link
              className="guest-stays-primary ui-link-button ui-button--primary"
              to={`/reservas/${data.reservationRef}`}
            >
              Ver reserva
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

/** Un dato del detalle; vacío (`null` o en blanco), una raya. */
function Datum({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{orEmpty(value)}</dd>
    </div>
  );
}

/** Un dato vacío (`null` o en blanco) como una raya "—". */
function orEmpty(value: string | null): string {
  return value === null || value.trim() === '' ? EMPTY : value;
}

/** `2026-10-09` como `09/10/2026` (plan base, "Fechas"). */
function formatDate(date: string): string {
  const [year, month, day] = date.split('-');
  return `${day}/${month}/${year}`;
}
