import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ErrorMessage } from '../../components/ErrorMessage.tsx';
import { SearchIcon } from '../../components/icons.tsx';
import { listOtas } from '../../services/otas.ts';
import {
  getDaySummary,
  listReservations,
  type MigrationStatus,
  type ReservationList,
  type ReservationListFilters,
  type ReservationListItem,
  type ReservationSource,
  type ReservationStatus,
} from '../../services/reservations.ts';
import './ReservationsPage.css';

/** Los estados, en el orden del filtro de la pantalla, con el nombre que ve la Recepcionista. */
const STATUS_LABELS: Record<ReservationStatus, string> = {
  ACTIVE: 'Activa',
  PENDING: 'Pendiente',
  IN_PROGRESS: 'En curso',
  COMPLETED: 'Completada',
  CANCELLED: 'Cancelada',
  NO_SHOW: 'No se presentó',
};

/** El estado migratorio de FR-005b: nunca se muestra vacío. */
const MIGRATION_LABELS: Record<MigrationStatus, string> = {
  AWAITING_CHECK_IN: 'Pendiente de Check-In',
  COMPLETE: 'Completo',
  NOT_REQUIRED: 'Sin extranjeros',
  NO_CHECK_IN: 'Sin Check-In',
};

const STATUSES = Object.keys(STATUS_LABELS) as ReservationStatus[];
const SOURCES: ReservationSource[] = ['DIRECT', 'OTA'];

/**
 * Los filtros viven en la dirección de la pantalla (`?status=ACTIVE&page=2`): así se conservan al cambiar
 * de página o de orden (FR-003a), al volver del detalle y al recargar.
 */
type ScreenFilters = {
  search: string;
  status: ReservationStatus | '';
  source: ReservationSource | '';
  otaId: string;
  inConflict: boolean;
  dateFrom: string;
  dateTo: string;
  order: 'asc' | 'desc';
  page: number;
};

function readFilters(params: URLSearchParams): ScreenFilters {
  const status = params.get('status') ?? '';
  const source = params.get('source') ?? '';
  const page = Number(params.get('page') ?? '1');
  return {
    search: params.get('search') ?? '',
    status: STATUSES.includes(status as ReservationStatus)
      ? (status as ReservationStatus)
      : '',
    source: SOURCES.includes(source as ReservationSource)
      ? (source as ReservationSource)
      : '',
    otaId: params.get('otaId') ?? '',
    inConflict: params.get('inConflict') === 'true',
    dateFrom: params.get('dateFrom') ?? '',
    dateTo: params.get('dateTo') ?? '',
    order: params.get('order') === 'asc' ? 'asc' : 'desc',
    page: Number.isInteger(page) && page >= 1 ? page : 1,
  };
}

/** Los filtros como parámetros de la dirección, sin los que tienen su valor por defecto. */
function toParams(filters: ScreenFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.search !== '') params.set('search', filters.search);
  if (filters.status !== '') params.set('status', filters.status);
  if (filters.source !== '') params.set('source', filters.source);
  if (filters.otaId !== '') params.set('otaId', filters.otaId);
  if (filters.inConflict) params.set('inConflict', 'true');
  if (filters.dateFrom !== '') params.set('dateFrom', filters.dateFrom);
  if (filters.dateTo !== '') params.set('dateTo', filters.dateTo);
  if (filters.order === 'asc') params.set('order', 'asc');
  if (filters.page > 1) params.set('page', String(filters.page));
  return params;
}

/**
 * Lo que se le pide al backend (C1). El rango de estadía solo se envía completo: con una sola fecha la
 * pantalla espera la otra. La agencia solo se envía con el canal `OTA`.
 */
function toRequest(filters: ScreenFilters): ReservationListFilters {
  const withRange = filters.dateFrom !== '' && filters.dateTo !== '';
  return {
    search: filters.search === '' ? undefined : filters.search,
    status: filters.status === '' ? undefined : filters.status,
    source: filters.source === '' ? undefined : filters.source,
    otaId:
      filters.source === 'OTA' && filters.otaId !== ''
        ? filters.otaId
        : undefined,
    inConflict: filters.inConflict ? true : undefined,
    dateFrom: withRange ? filters.dateFrom : undefined,
    dateTo: withRange ? filters.dateTo : undefined,
    order: filters.order,
    page: filters.page,
  };
}

/**
 * Pantalla "Consultar reservas" (spec de `check-view-reservation`, historia 1; plan, C1 y C2): el resumen
 * del día operativo, el cuadro de búsqueda, los filtros, el orden, el listado de a 10 y su paginación.
 * Las validaciones las hace el backend: su mensaje se muestra tal cual.
 */
export function ReservationsPage() {
  const [params, setParams] = useSearchParams();
  const filters = readFilters(params);

  /** Cambia filtros y vuelve a la página 1; solo la paginación conserva la página. */
  const change = (changes: Partial<ScreenFilters>) => {
    setParams(toParams({ ...filters, page: 1, ...changes }));
  };

  return (
    <section className="reservations ui-page">
      <header className="reservations-header ui-page-header">
        <div>
          <h1 className="reservations-title ui-page-title">
            Consultar reservas
          </h1>
          <p className="ui-page-subtitle">
            Busque, filtre y abra las reservas del hotel.
          </p>
        </div>
      </header>
      <DaySummaryPanel />
      <Filters key={filters.search} filters={filters} onChange={change} />
      <div className="reservations-panel ui-panel">
        <Results filters={filters} onPage={(page) => change({ page })} />
      </div>
    </section>
  );
}

/** El resumen del día operativo (FR-005a), encima del listado. Si falla, no tapa el listado. */
function DaySummaryPanel() {
  const summary = useQuery({
    queryKey: ['reservations', 'day-summary'],
    queryFn: ({ signal }) => getDaySummary(signal),
  });

  if (summary.isPending) {
    return (
      <p className="reservations-summary reservations-summary--loading ui-ribbon">
        Cargando el resumen del día…
      </p>
    );
  }
  if (summary.isError) {
    return (
      <div className="reservations-summary reservations-summary--error">
        <ErrorMessage error={summary.error} />
      </div>
    );
  }
  return (
    <dl
      className="reservations-summary ui-ribbon"
      aria-label={`Resumen del día ${formatDate(summary.data.operationalDate)}`}
    >
      <div className="reservations-summary-item">
        <dt>Llegadas esperadas hoy</dt>
        <dd>{summary.data.expectedArrivals}</dd>
      </div>
      <div className="reservations-summary-item">
        <dt>Salidas esperadas hoy</dt>
        <dd>{summary.data.expectedDepartures}</dd>
      </div>
      <div className="reservations-summary-item reservations-summary-item--date">
        <dt>Día operativo</dt>
        <dd>{formatDate(summary.data.operationalDate)}</dd>
      </div>
    </dl>
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

  // Las agencias solo hacen falta con el canal OTA (FR-004).
  const otas = useQuery({
    queryKey: ['otas'],
    queryFn: ({ signal }) => listOtas(signal),
    enabled: filters.source === 'OTA',
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onChange({ search: search.trim() });
  };

  const clear = () => {
    setSearch('');
    onChange({
      search: '',
      status: '',
      source: '',
      otaId: '',
      inConflict: false,
      dateFrom: '',
      dateTo: '',
      order: 'desc',
    });
  };

  const incompleteRange = (filters.dateFrom === '') !== (filters.dateTo === '');

  return (
    <form
      className="reservations-filters ui-panel ui-toolbar"
      aria-label="Filtros"
      onSubmit={submit}
      noValidate
    >
      <div className="reservations-field reservations-field--search ui-field">
        <label htmlFor="reservations-search">Buscar</label>
        <div className="reservations-search">
          <SearchIcon size={15} className="reservations-search-icon" />
          <input
            id="reservations-search"
            type="search"
            value={search}
            maxLength={40}
            placeholder="Referencia, código OTA, documento o nombre"
            onChange={(event) => setSearch(event.target.value)}
          />
          <button type="submit">Buscar</button>
        </div>
      </div>
      <div className="reservations-field ui-field">
        <label htmlFor="reservations-status">Estado</label>
        <select
          id="reservations-status"
          value={filters.status}
          onChange={(event) =>
            onChange({ status: event.target.value as ReservationStatus | '' })
          }
        >
          <option value="">Todos</option>
          {STATUSES.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABELS[status]}
            </option>
          ))}
        </select>
      </div>
      <div className="reservations-field ui-field">
        <label htmlFor="reservations-source">Canal</label>
        <select
          id="reservations-source"
          value={filters.source}
          onChange={(event) =>
            // Al salir del canal OTA se quita la agencia: solo aplica a ese canal.
            onChange({
              source: event.target.value as ReservationSource | '',
              otaId: '',
            })
          }
        >
          <option value="">Todos</option>
          <option value="DIRECT">Directo</option>
          <option value="OTA">OTA</option>
        </select>
      </div>
      <div className="reservations-field ui-field">
        <label htmlFor="reservations-ota">Agencia</label>
        <select
          id="reservations-ota"
          value={filters.otaId}
          disabled={filters.source !== 'OTA'}
          onChange={(event) => onChange({ otaId: event.target.value })}
        >
          <option value="">Todas</option>
          {(otas.data?.items ?? []).map((ota) => (
            <option key={ota.id} value={ota.id}>
              {ota.name}
            </option>
          ))}
        </select>
      </div>
      <div className="reservations-field ui-field">
        <label htmlFor="reservations-from">Desde</label>
        <input
          id="reservations-from"
          type="date"
          value={filters.dateFrom}
          onChange={(event) => onChange({ dateFrom: event.target.value })}
        />
      </div>
      <div className="reservations-field ui-field">
        <label htmlFor="reservations-to">Hasta</label>
        <input
          id="reservations-to"
          type="date"
          value={filters.dateTo}
          onChange={(event) => onChange({ dateTo: event.target.value })}
        />
      </div>
      <div className="reservations-field ui-field">
        <label htmlFor="reservations-order">Orden</label>
        <select
          id="reservations-order"
          value={filters.order}
          onChange={(event) =>
            onChange({ order: event.target.value as 'asc' | 'desc' })
          }
        >
          <option value="desc">Llegada: más reciente primero</option>
          <option value="asc">Llegada: más antigua primero</option>
        </select>
      </div>
      <label className="reservations-check ui-check">
        <input
          type="checkbox"
          checked={filters.inConflict}
          onChange={(event) => onChange({ inConflict: event.target.checked })}
        />
        Solo en conflicto
      </label>
      <button
        type="button"
        className="reservations-clear ui-button--ghost"
        onClick={clear}
      >
        Limpiar filtros
      </button>
      {incompleteRange && (
        <p className="reservations-hint">
          Complete las dos fechas para filtrar por estadía.
        </p>
      )}
    </form>
  );
}

function Results({
  filters,
  onPage,
}: {
  filters: ScreenFilters;
  onPage: (page: number) => void;
}) {
  const request = toRequest(filters);
  const reservations = useQuery({
    queryKey: ['reservations', 'list', request],
    queryFn: ({ signal }) => listReservations(request, signal),
  });

  if (reservations.isPending) {
    return (
      <p className="reservations-state reservations-state--loading ui-state ui-state--loading">
        Cargando reservas…
      </p>
    );
  }
  if (reservations.isError) {
    return <ErrorMessage error={reservations.error} />;
  }
  if (reservations.data.items.length === 0) {
    return (
      <p className="reservations-state ui-state">
        {reservations.data.message ??
          'No se encontraron reservas con los filtros aplicados.'}
      </p>
    );
  }
  return (
    <>
      <ReservationsTable reservations={reservations.data.items} />
      <Pagination list={reservations.data} onPage={onPage} />
    </>
  );
}

function ReservationsTable({
  reservations,
}: {
  reservations: ReservationListItem[];
}) {
  return (
    <div className="ui-scroll-x">
      <table className="reservations-table ui-table ui-table--sticky">
        <thead>
          <tr>
            <th scope="col">Ref. reserva</th>
            <th scope="col">Huésped</th>
            <th scope="col">Habitaciones</th>
            <th scope="col">Canal</th>
            <th scope="col">Fechas (in → out)</th>
            <th scope="col">Estado</th>
            <th scope="col">Migración</th>
            <th scope="col">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {reservations.map((reservation) => (
            <ReservationRow
              key={reservation.reservationRef}
              reservation={reservation}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReservationRow({ reservation }: { reservation: ReservationListItem }) {
  const { reservationRef, actions } = reservation;
  return (
    <tr>
      <td>
        <span className="reservations-ref">{reservationRef}</span>
        {reservation.externalConfirmationCode !== null && (
          <span className="reservations-secondary ui-secondary">
            {reservation.externalConfirmationCode}
          </span>
        )}
      </td>
      <td>
        <span className="reservations-guest">{reservation.guest.fullName}</span>
        {reservation.guest.documentNumber !== null && (
          <span className="reservations-secondary ui-secondary">
            {reservation.guest.documentNumber}
          </span>
        )}
      </td>
      <td>
        <ul className="reservations-rooms">
          {reservation.rooms.map((room, index) => (
            // Una reserva puede tener varias habitaciones sin asignar: no hay otra clave estable.
            <li key={index}>
              {room.roomNumber ?? 'Sin asignar'} · {room.categoryRoom}
            </li>
          ))}
        </ul>
      </td>
      <td>
        {reservation.source === 'DIRECT' ? (
          'Directo'
        ) : (
          <>
            OTA
            {reservation.otaName !== null && (
              <span className="reservations-secondary ui-secondary">
                {reservation.otaName}
              </span>
            )}
          </>
        )}
      </td>
      <td className="reservations-dates">
        {formatDate(reservation.startDate)} → {formatDate(reservation.endDate)}
      </td>
      <td>
        <span
          className={`reservations-status ui-badge reservations-status--${reservation.status.toLowerCase()}`}
        >
          {STATUS_LABELS[reservation.status]}
        </span>
        {reservation.conflict !== null && (
          <span className="reservations-conflict ui-badge tone-critical">
            En conflicto
          </span>
        )}
      </td>
      <td>{MIGRATION_LABELS[reservation.migrationStatus]}</td>
      <td>
        <span className="reservations-actions">
          <Link
            to={`/reservas/${reservationRef}`}
            aria-label={`Ver detalle de ${reservationRef}`}
          >
            Ver detalle
          </Link>
          <Action
            enabled={actions.canModify}
            to={`/reservas/${reservationRef}/modificar`}
            label={`Modificar ${reservationRef}`}
          >
            Modificar
          </Action>
          <Action
            enabled={actions.canCancel}
            to={`/reservas/${reservationRef}/cancelar`}
            label={`Cancelar ${reservationRef}`}
          >
            Cancelar
          </Action>
          {actions.canAssignRoom && (
            <Link
              to={`/reservas/${reservationRef}/asignar-habitacion`}
              aria-label={`Asignar habitación a ${reservationRef}`}
            >
              Asignar habitación
            </Link>
          )}
        </span>
      </td>
    </tr>
  );
}

/** Una acción de la fila: un enlace si la reserva la admite; si no, el mismo texto deshabilitado. */
function Action({
  enabled,
  to,
  label,
  children,
}: {
  enabled: boolean;
  to: string;
  label: string;
  children: string;
}) {
  if (!enabled) {
    return (
      <span
        className="reservations-action--disabled"
        aria-disabled="true"
        aria-label={label}
        role="link"
      >
        {children}
      </span>
    );
  }
  return (
    <Link to={to} aria-label={label}>
      {children}
    </Link>
  );
}

function Pagination({
  list,
  onPage,
}: {
  list: ReservationList;
  onPage: (page: number) => void;
}) {
  return (
    <nav
      className="reservations-pagination ui-pagination"
      aria-label="Paginación"
    >
      <span>
        {list.totalItems === 1 ? '1 reserva' : `${list.totalItems} reservas`}
      </span>
      <button
        type="button"
        disabled={list.page <= 1}
        onClick={() => onPage(list.page - 1)}
      >
        Anterior
      </button>
      <span aria-current="page">
        Página {list.page} de {list.totalPages}
      </span>
      <button
        type="button"
        disabled={list.page >= list.totalPages}
        onClick={() => onPage(list.page + 1)}
      >
        Siguiente
      </button>
    </nav>
  );
}

/** `2026-10-23` como `23/10/2026` (plan base, "Fechas"). */
function formatDate(date: string): string {
  const [year, month, day] = date.split('-');
  return `${day}/${month}/${year}`;
}
