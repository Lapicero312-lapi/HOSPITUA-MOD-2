import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import Avatar from '../../components/Avatar.tsx';
import { ErrorMessage } from '../../components/ErrorMessage.tsx';
import {
  getGuestStayDetail,
  listGuestStays,
  type GuestStay,
  type GuestStayDetail,
  type GuestStayFilters,
} from '../../services/guest-stays.ts';

type GuestStayKey = {
  reservationRef: string;
  documentNumber: string;
};

const EMPTY_FILTERS: GuestStayFilters = {
  nationality: 'ALL',
  presence: 'ALL',
  dateFrom: '',
  dateTo: '',
  search: '',
  page: 1,
};

function filtersFromParams(params: URLSearchParams): GuestStayFilters {
  const nationality = params.get('nationality');
  const presence = params.get('presence');
  const page = Number(params.get('page') ?? '1');
  return {
    nationality:
      nationality === 'FOREIGN' || nationality === 'COLOMBIAN'
        ? nationality
        : 'ALL',
    presence:
      presence === 'IN_HOTEL' || presence === 'CHECKED_OUT' ? presence : 'ALL',
    dateFrom: params.get('dateFrom') ?? '',
    dateTo: params.get('dateTo') ?? '',
    search: params.get('search') ?? '',
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

function formatDate(value: string | null): string {
  if (value === null) {
    return '—';
  }
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) {
    return value;
  }
  return new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' }).format(
    new Date(year, month - 1, day),
  );
}

function filtersToParams(filters: GuestStayFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.nationality !== 'ALL') {
    params.set('nationality', filters.nationality);
  }
  if (filters.presence !== 'ALL') {
    params.set('presence', filters.presence);
  }
  if (filters.dateFrom) {
    params.set('dateFrom', filters.dateFrom);
  }
  if (filters.dateTo) {
    params.set('dateTo', filters.dateTo);
  }
  if (filters.search.trim()) {
    params.set('search', filters.search.trim());
  }
  if (filters.page > 1) {
    params.set('page', String(filters.page));
  }
  return params;
}

function detailName(detail: GuestStayDetail): string {
  return `${detail.guest.firstName} ${detail.guest.lastName}`;
}

function GuestStayDetailDialog({
  guestStay,
  onClose,
}: {
  guestStay: GuestStayKey;
  onClose: () => void;
}) {
  const query = useQuery({
    queryKey: [
      'guest-stay-detail',
      guestStay.reservationRef,
      guestStay.documentNumber,
    ],
    queryFn: () =>
      getGuestStayDetail(guestStay.reservationRef, guestStay.documentNumber),
  });

  return (
    <div
      className="overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className="modal guest-stay-detail"
        role="dialog"
        aria-modal="true"
        aria-labelledby="guest-stay-detail-title"
      >
        {query.isPending && <p>Consultando detalle del huésped...</p>}
        {query.isError && <ErrorMessage error={query.error} />}
        {query.isSuccess && (
          <>
            <h2 id="guest-stay-detail-title">{detailName(query.data)}</h2>
            <dl className="guest-detail-grid">
              <div>
                <dt>Documento</dt>
                <dd>
                  {query.data.guest.documentType}{' '}
                  {query.data.guest.documentNumber}
                </dd>
              </div>
              <div>
                <dt>Fecha de nacimiento</dt>
                <dd>{formatDate(query.data.guest.birthDate)}</dd>
              </div>
              <div>
                <dt>Nacionalidad</dt>
                <dd>
                  {query.data.guest.nationality}
                  {query.data.guest.isForeign ? ' · Extranjero' : ''}
                </dd>
              </div>
              <div>
                <dt>Lugar de procedencia</dt>
                <dd>{query.data.guest.originPlace ?? '—'}</dd>
              </div>
              <div>
                <dt>Lugar de destino</dt>
                <dd>{query.data.guest.destinationPlace ?? '—'}</dd>
              </div>
              <div>
                <dt>Reserva</dt>
                <dd>{query.data.reservationRef}</dd>
              </div>
            </dl>
            <div className="tablewrap">
              <table>
                <caption>Movimientos migratorios</caption>
                <thead>
                  <tr>
                    <th scope="col">Movimiento</th>
                    <th scope="col">Fecha</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.movements.map((movement) => (
                    <tr key={movement.movementType}>
                      <td>
                        {movement.movementType === 'ENTRY'
                          ? 'Entrada'
                          : 'Salida'}
                      </td>
                      <td>{formatDate(movement.movementDate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="guest-detail-actions">
              <button className="btn" type="button" onClick={onClose}>
                Cerrar
              </button>
              <Link
                className="btn primary"
                to={`/reservations/${encodeURIComponent(query.data.reservationRef)}`}
              >
                Ver reserva
              </Link>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function GuestStayRow({
  stay,
  onOpen,
}: {
  stay: GuestStay;
  onOpen: (guestStay: GuestStayKey) => void;
}) {
  const name = `${stay.guest.firstName} ${stay.guest.lastName}`;
  return (
    <tr>
      <td>
        <div className="person">
          <Avatar name={name} />
          <div>
            {name}
            <br />
            <span className="note">
              {stay.guest.documentType} {stay.guest.documentNumber}
            </span>
          </div>
        </div>
      </td>
      <td>
        {stay.guest.nationality}
        {stay.guest.isForeign && (
          <span className="badge m1 guest-foreign-badge">Extranjero</span>
        )}
      </td>
      <td>
        <Link
          className="btn sm"
          to={`/reservations/${encodeURIComponent(stay.reservationRef)}`}
        >
          {stay.reservationRef}
        </Link>
      </td>
      <td>{formatDate(stay.entryDate)}</td>
      <td>
        {stay.inHotel ? (
          <span className="badge ok">En el hotel</span>
        ) : (
          formatDate(stay.exitDate)
        )}
      </td>
      <td>
        <button
          className="btn sm"
          type="button"
          onClick={() =>
            onOpen({
              reservationRef: stay.reservationRef,
              documentNumber: stay.guest.documentNumber,
            })
          }
        >
          Ver detalle
        </button>
      </td>
    </tr>
  );
}

export function GuestStaysPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const paramsKey = searchParams.toString();
  const appliedFilters = filtersFromParams(searchParams);
  const [draftState, setDraftState] = useState({
    paramsKey,
    filters: appliedFilters,
  });
  const draftFilters =
    draftState.paramsKey === paramsKey ? draftState.filters : appliedFilters;
  const [selectedGuest, setSelectedGuest] = useState<GuestStayKey | null>(null);
  const query = useQuery({
    queryKey: ['guest-stays', appliedFilters],
    queryFn: () => listGuestStays(appliedFilters),
  });

  const updateDraft = <K extends keyof GuestStayFilters>(
    key: K,
    value: GuestStayFilters[K],
  ) => {
    setDraftState({
      paramsKey,
      filters: { ...draftFilters, [key]: value },
    });
  };

  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const filters = { ...draftFilters, page: 1 };
    const params = filtersToParams(filters);
    setDraftState({ paramsKey: params.toString(), filters });
    setSearchParams(params);
  };

  const setPage = (page: number) => {
    setSearchParams(filtersToParams({ ...appliedFilters, page }));
  };

  const clearFilters = () => {
    setDraftState({ paramsKey: '', filters: EMPTY_FILTERS });
    setSearchParams(new URLSearchParams());
  };

  const pages = query.data?.totalPages ?? 0;
  const pageNumbers =
    pages === 0
      ? []
      : Array.from(
          { length: Math.min(5, pages) },
          (_, index) =>
            Math.max(1, Math.min(appliedFilters.page - 2, pages - 4)) + index,
        );

  return (
    <>
      <section className="panel guest-stays-page">
        <h2>Huéspedes alojados</h2>
        <form onSubmit={applyFilters}>
          <div className="row guest-stay-filters">
            <div className="field guest-search-field">
              <label htmlFor="guest-search">Buscar</label>
              <input
                id="guest-search"
                value={draftFilters.search}
                onChange={(event) => updateDraft('search', event.target.value)}
                placeholder="Número de documento o nombre"
              />
            </div>
            <div className="field">
              <label htmlFor="guest-nationality">Nacionalidad</label>
              <select
                id="guest-nationality"
                value={draftFilters.nationality}
                onChange={(event) =>
                  updateDraft(
                    'nationality',
                    event.target.value as GuestStayFilters['nationality'],
                  )
                }
              >
                <option value="ALL">Todos</option>
                <option value="FOREIGN">Extranjeros</option>
                <option value="COLOMBIAN">Colombianos</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="guest-presence">Situación</label>
              <select
                id="guest-presence"
                value={draftFilters.presence}
                onChange={(event) =>
                  updateDraft(
                    'presence',
                    event.target.value as GuestStayFilters['presence'],
                  )
                }
              >
                <option value="ALL">Todos</option>
                <option value="IN_HOTEL">En el hotel</option>
                <option value="CHECKED_OUT">Ya salió</option>
              </select>
            </div>
          </div>
          <div className="row guest-stay-filters">
            <div className="field">
              <label htmlFor="guest-date-from">Desde</label>
              <input
                id="guest-date-from"
                type="date"
                value={draftFilters.dateFrom}
                onChange={(event) =>
                  updateDraft('dateFrom', event.target.value)
                }
              />
            </div>
            <div className="field">
              <label htmlFor="guest-date-to">Hasta</label>
              <input
                id="guest-date-to"
                type="date"
                value={draftFilters.dateTo}
                onChange={(event) => updateDraft('dateTo', event.target.value)}
              />
            </div>
            <div className="guest-filter-actions">
              <button className="btn primary" type="submit">
                Aplicar filtros
              </button>
              <button className="btn" type="button" onClick={clearFilters}>
                Limpiar filtros
              </button>
            </div>
          </div>
        </form>

        {query.isPending && <p>Consultando huéspedes alojados...</p>}
        {query.isError && <ErrorMessage error={query.error} />}
        {query.isSuccess && query.data.totalItems === 0 && (
          <p className="note guest-stay-empty">{query.data.message}</p>
        )}
        {query.isSuccess && query.data.items.length > 0 && (
          <>
            <div className="tablewrap">
              <table>
                <caption className="visually-hidden">
                  Huéspedes alojados
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Huésped</th>
                    <th scope="col">Nacionalidad</th>
                    <th scope="col">Reserva</th>
                    <th scope="col">Entrada</th>
                    <th scope="col">Salida</th>
                    <th scope="col">
                      <span className="visually-hidden">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.items.map((stay) => (
                    <GuestStayRow
                      key={`${stay.reservationRef}-${stay.guest.documentNumber}`}
                      stay={stay}
                      onOpen={setSelectedGuest}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <nav className="pager guest-stay-pager" aria-label="Paginación">
              <span className="note">
                Mostrando {(query.data.page - 1) * query.data.pageSize + 1}–
                {Math.min(
                  query.data.page * query.data.pageSize,
                  query.data.totalItems,
                )}{' '}
                de {query.data.totalItems} huéspedes · página {query.data.page}{' '}
                de {query.data.totalPages}
              </span>
              <div className="pagerbtns">
                <button
                  className="btn sm"
                  type="button"
                  disabled={query.data.page <= 1}
                  onClick={() => setPage(query.data.page - 1)}
                >
                  ← Anterior
                </button>
                {pageNumbers.map((page) => (
                  <button
                    className={`btn sm${page === query.data.page ? ' primary' : ''}`}
                    type="button"
                    key={page}
                    aria-current={page === query.data.page ? 'page' : undefined}
                    onClick={() => setPage(page)}
                  >
                    {page}
                  </button>
                ))}
                <button
                  className="btn sm"
                  type="button"
                  disabled={query.data.page >= query.data.totalPages}
                  onClick={() => setPage(query.data.page + 1)}
                >
                  Siguiente →
                </button>
              </div>
            </nav>
          </>
        )}
      </section>
      {selectedGuest !== null && (
        <GuestStayDetailDialog
          guestStay={selectedGuest}
          onClose={() => setSelectedGuest(null)}
        />
      )}
    </>
  );
}
