import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import Avatar from '../components/Avatar';
import {
  ChannelBadge,
  ConflictBadge,
  ErrorBox,
  MigrationBadge,
  StatusBadge,
} from '../components/Badges';
import Pagination from '../components/Pagination';
import {
  getDaySummary,
  listOtas,
  listReservations,
} from '../services/reservations';
import {
  categoryLabel,
  changeBlockReason,
  formatDate,
  STATUS_LABEL,
} from '../utils/format';
import { validateDateRange, validateSearch } from '../utils/validators';

export default function ReservationsListPage() {
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams(); // los filtros viven en la URL: "atrás" conserva la búsqueda
  const filters = Object.fromEntries(sp);
  const [formError, setFormError] = useState<string | null>(null);
  const [source, setSource] = useState(sp.get('source') ?? '');
  useEffect(() => setSource(sp.get('source') ?? ''), [sp]);

  const list = useQuery({
    queryKey: ['reservations', filters],
    queryFn: () => listReservations(filters),
    placeholderData: keepPreviousData,
  });
  const summary = useQuery({
    queryKey: ['day-summary'],
    queryFn: getDaySummary,
  });
  const otas = useQuery({ queryKey: ['otas'], queryFn: listOtas });

  const apply = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const get = (k: string) => String(f.get(k) ?? '').trim();
    const err =
      (get('search') ? validateSearch(get('search')) : null) ??
      validateDateRange(get('dateFrom'), get('dateTo'));
    setFormError(err);
    if (err) return;
    const next = new URLSearchParams();
    ['search', 'status', 'source', 'dateFrom', 'dateTo', 'order'].forEach(
      (k) => get(k) && next.set(k, get(k)),
    );
    if (get('source') === 'OTA' && get('otaId'))
      next.set('otaId', get('otaId')); // la agencia solo aplica al canal OTA
    if (f.get('inConflict')) next.set('inConflict', 'true');
    setSp(next);
  };
  const goTo = (page: number) => {
    const n = new URLSearchParams(sp);
    n.set('page', String(page));
    setSp(n);
  };

  return (
    <>
      <div className="statrow">
        <div className="statcard">
          <div className="lbl">Llegadas esperadas hoy</div>
          <div className="val">{summary.data?.expectedArrivals ?? '—'}</div>
        </div>
        <div className="statcard">
          <div className="lbl">Salidas esperadas hoy</div>
          <div className="val">{summary.data?.expectedDepartures ?? '—'}</div>
          <div className="sub">
            Día operativo {formatDate(summary.data?.operationalDate)}
          </div>
        </div>
      </div>

      <div className="panel">
        <h2>
          Consultar reservas{' '}
          <button
            className="btn primary sm"
            style={{ marginLeft: 'auto' }}
            onClick={() => nav('/reservas/nueva')}
          >
            + Nueva reserva directa
          </button>
        </h2>
        <form onSubmit={apply} key={sp.toString()}>
          <div className="row">
            <div className="field" style={{ flex: 1, minWidth: 240 }}>
              <label htmlFor="fSearch">Buscar</label>
              <input
                id="fSearch"
                name="search"
                defaultValue={sp.get('search') ?? ''}
                placeholder="Código de reserva o de la OTA, documento (sin puntos) o nombre"
              />
            </div>
            <div className="field">
              <label htmlFor="fEstado">Estado</label>
              <select
                id="fEstado"
                name="status"
                defaultValue={sp.get('status') ?? ''}
              >
                <option value="">Todos</option>
                {Object.entries(STATUS_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="fCanal">Canal</label>
              <select
                id="fCanal"
                name="source"
                value={source}
                onChange={(e) => setSource(e.target.value)}
              >
                <option value="">Todos</option>
                <option value="DIRECT">Directo</option>
                <option value="OTA">OTA</option>
              </select>
            </div>
            {source === 'OTA' && (
              <div className="field">
                <label htmlFor="fAgencia">Agencia</label>
                <select
                  id="fAgencia"
                  name="otaId"
                  defaultValue={sp.get('otaId') ?? ''}
                >
                  <option value="">Todas</option>
                  {otas.data?.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <div className="row">
            <div className="field">
              <label htmlFor="fDesde">Desde</label>
              <input
                id="fDesde"
                type="date"
                name="dateFrom"
                defaultValue={sp.get('dateFrom') ?? ''}
              />
            </div>
            <div className="field">
              <label htmlFor="fHasta">Hasta</label>
              <input
                id="fHasta"
                type="date"
                name="dateTo"
                defaultValue={sp.get('dateTo') ?? ''}
              />
            </div>
            <div className="field">
              <label htmlFor="fOrden">Orden</label>
              <select
                id="fOrden"
                name="order"
                defaultValue={sp.get('order') ?? 'desc'}
              >
                <option value="desc">Llegada: más reciente primero</option>
                <option value="asc">Llegada: más antigua primero</option>
              </select>
            </div>
            <label className="check">
              <input
                type="checkbox"
                name="inConflict"
                defaultChecked={sp.get('inConflict') === 'true'}
              />{' '}
              Solo en conflicto
            </label>
            <button className="btn primary">Filtrar</button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setFormError(null);
                setSp({});
              }}
            >
              Limpiar filtros
            </button>
          </div>
        </form>
        {formError && (
          <p className="field">
            <span className="err">{formError}</span>
          </p>
        )}
        {list.error && <ErrorBox error={list.error} />}
        <p className="note">
          Las reservas de las agencias no se crean aquí: llegan integradas y
          solo se consultan.
        </p>
      </div>

      {list.data && (
        <div className="panel">
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Ref. reserva</th>
                  <th>Huésped</th>
                  <th>Habitaciones</th>
                  <th>Canal</th>
                  <th>Fechas (in → out)</th>
                  <th>Estado</th>
                  <th>Migración</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.data.items.length === 0 && (
                  <tr>
                    <td
                      colSpan={8}
                      className="note"
                      style={{ textAlign: 'center', padding: 24 }}
                    >
                      {list.data.message}
                    </td>
                  </tr>
                )}
                {list.data.items.map((r) => {
                  const reason = changeBlockReason(r.status, r.otaName);
                  const cats = [
                    ...new Set(
                      r.rooms.map((x) => categoryLabel(x.categoryRoom)),
                    ),
                  ].join(', ');
                  return (
                    <tr key={r.reservationRef}>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <b className="code">{r.reservationRef}</b>
                        {r.externalConfirmationCode && (
                          <>
                            <br />
                            <span className="note">
                              Cód. OTA {r.externalConfirmationCode}
                            </span>
                          </>
                        )}
                      </td>
                      <td>
                        <div className="person">
                          <Avatar name={r.guest.fullName} />
                          <div>
                            {r.guest.fullName}
                            <br />
                            <span className="note">
                              {r.guest.documentNumber ?? 'Sin documento'}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td>
                        {r.rooms
                          .map((x) =>
                            x.roomNumber
                              ? `Hab. ${x.roomNumber}`
                              : 'Sin asignar',
                          )
                          .join(', ')}
                        <br />
                        <span className="note">{cats}</span>
                      </td>
                      <td>
                        <ChannelBadge source={r.source} otaName={r.otaName} />
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {formatDate(r.startDate)} →<br />
                        {formatDate(r.endDate)}
                      </td>
                      <td>
                        <StatusBadge status={r.status} />
                        <ConflictBadge conflict={r.conflict} />
                      </td>
                      <td>
                        <MigrationBadge value={r.migrationStatus} />
                      </td>
                      <td>
                        <div className="rowacts">
                          <button
                            className="btn sm"
                            onClick={() => nav(`/reservas/${r.reservationRef}`)}
                          >
                            Ver detalle
                          </button>
                          {r.actions.canAssignRoom && (
                            <button
                              className="btn sm primary"
                              onClick={() =>
                                nav(`/reservas/${r.reservationRef}/habitacion`)
                              }
                            >
                              Asignar habitación
                            </button>
                          )}
                          <button
                            className="btn sm"
                            disabled={!r.actions.canModify}
                            title={r.actions.canModify ? '' : reason}
                            onClick={() =>
                              nav(`/reservas/${r.reservationRef}/modificar`)
                            }
                          >
                            Modificar
                          </button>
                          <button
                            className="btn sm danger"
                            disabled={!r.actions.canCancel}
                            title={r.actions.canCancel ? '' : reason}
                            onClick={() =>
                              nav(`/reservas/${r.reservationRef}/cancelar`)
                            }
                          >
                            Cancelar
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination
            page={list.data.page}
            totalPages={list.data.totalPages}
            totalItems={list.data.totalItems}
            onChange={goTo}
          />
        </div>
      )}
      {list.isPending && <p className="note">Cargando reservas…</p>}
    </>
  );
}
