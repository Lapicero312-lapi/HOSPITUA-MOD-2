import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ErrorBox } from '../components/Badges';
import { ApiError } from '../services/api-client.ts';
import {
  getDaySummary,
  getReservation,
  listRooms,
  previewModification,
  updateReservation,
} from '../services/reservations';
import type { ReservationDetail, Room } from '../types';
import {
  canChange,
  changeBlockReason,
  categoryLabel,
  formatMoney,
} from '../utils/format';
import {
  buildBody,
  initialValues,
  validateModification,
  type ModifyValues,
} from '../utils/modifyForm';
import { useDebounced } from '../utils/useDebounced';

const DOC_TYPES: [string, string][] = [
  ['RC', 'Registro Civil'],
  ['TI', 'Tarjeta de Identidad'],
  ['CC', 'Cédula de ciudadanía'],
  ['CE', 'Cédula de extranjería'],
  ['PAS', 'Pasaporte'],
  ['NIT', 'NIT'],
];

export default function ModifyReservationPage() {
  const { ref = '' } = useParams();
  const detail = useQuery({
    queryKey: ['reservation', ref],
    queryFn: () => getReservation(ref),
  });
  const rooms = useQuery({ queryKey: ['rooms'], queryFn: listRooms });
  const summary = useQuery({
    queryKey: ['day-summary'],
    queryFn: getDaySummary,
  });
  const back = (
    <Link className="crumbnav" to={`/reservas/${ref}`}>
      ← Volver al detalle
    </Link>
  );
  if (detail.error)
    return (
      <>
        {back}
        <ErrorBox error={detail.error} />
      </>
    );
  if (!detail.data || !rooms.data || !summary.data)
    return <p className="note">Cargando reserva…</p>;
  const r = detail.data;
  if (!canChange(r.status, r.source))
    return (
      <>
        {back}
        <div className="lockbox" style={{ marginTop: 10 }}>
          🔒 {changeBlockReason(r.status, r.otaName)}.
        </div>
      </>
    );
  // key = updatedAt: si otra persona la modifica y se recarga, el formulario vuelve a empezar con los datos nuevos.
  return (
    <ModifyForm
      key={r.updatedAt}
      r={r}
      inventory={rooms.data.items}
      today={summary.data.operationalDate}
      back={back}
    />
  );
}

function ModifyForm({
  r: detail,
  inventory,
  today,
  back,
}: {
  r: ReservationDetail;
  inventory: Room[];
  today: string;
  back: React.ReactNode;
}) {
  const nav = useNavigate();
  const qc = useQueryClient();
  // Si el detalle no trae roomId, se resuelve con el inventario (por número de habitación).
  const r = useMemo<ReservationDetail>(
    () => ({
      ...detail,
      rooms: detail.rooms.map((x) => ({
        ...x,
        roomId:
          x.roomId ?? inventory.find((q) => q.roomNumber === x.roomNumber)?.id,
      })),
    }),
    [detail, inventory],
  );
  const [v, setV] = useState<ModifyValues>(() => initialValues(r));
  const byId = useMemo(
    () => new Map(inventory.map((x) => [x.id, x])),
    [inventory],
  );
  const capacityOf = (id: string) => byId.get(id)?.maxCapacity ?? 0;

  const clientError = validateModification(v, today, capacityOf);
  const body = useMemo(() => buildBody(r, v), [r, v]);
  const request = clientError ? null : body;
  const debounced = useDebounced(request);
  const preview = useQuery({
    queryKey: ['modification-preview', r.reservationRef, debounced],
    queryFn: () => previewModification(r.reservationRef, debounced!),
    enabled: !!debounced && debounced === request,
    retry: false,
  });
  const save = useMutation({
    mutationFn: () =>
      updateReservation(r.reservationRef, {
        ...request!, // el servidor vuelve a cotizar; aquí solo va lo que vio la Recepcionista
        ...(preview.data?.requiresConfirmation
          ? {
              expectedRates: preview.data.quotes!.rooms.map((q) => ({
                roomId: q.key,
                lodgingAmount: q.lodgingAmount.amount,
              })),
            }
          : {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reservation', r.reservationRef] });
      qc.invalidateQueries({ queryKey: ['reservations'] });
      nav(`/reservas/${r.reservationRef}`);
    },
    onError: (e) => {
      if (
        e instanceof ApiError &&
        ['RATE_CHANGED', 'NO_AVAILABILITY'].includes(e.errorCode)
      )
        preview.refetch();
    },
  });
  const concurrent =
    save.error instanceof ApiError &&
    save.error.errorCode === 'CONCURRENT_UPDATE';
  const canSave =
    !!request && !!preview.data && !save.isPending && debounced === request;

  const setRoom = (i: number, patch: Partial<ModifyValues['rooms'][number]>) =>
    setV({
      ...v,
      rooms: v.rooms.map((x, j) => (j === i ? { ...x, ...patch } : x)),
    });
  const setG =
    (k: keyof ModifyValues['guest']) => (e: { target: { value: string } }) =>
      setV({ ...v, guest: { ...v.guest, [k]: e.target.value } });
  const used = new Set(v.rooms.map((x) => x.roomId));
  const c = preview.data?.changes;

  return (
    <>
      {back}
      <div className="panel" style={{ marginTop: 10 }}>
        <h2>Modificar {r.reservationRef}</h2>
        <div className="grid2">
          <div>
            <div className="row">
              <div className="field">
                <label className="req" htmlFor="sd">
                  Fecha de entrada
                </label>
                <input
                  id="sd"
                  type="date"
                  min={today}
                  value={v.startDate}
                  onChange={(e) => setV({ ...v, startDate: e.target.value })}
                />
              </div>
              <div className="field">
                <label className="req" htmlFor="ed">
                  Fecha de salida
                </label>
                <input
                  id="ed"
                  type="date"
                  min={v.startDate || today}
                  value={v.endDate}
                  onChange={(e) => setV({ ...v, endDate: e.target.value })}
                />
              </div>
            </div>

            <p className="note">
              Habitaciones de la reserva (entre 1 y 10). Puede cambiar una por
              otra, de la misma o de otra categoría, agregar o quitar.
            </p>
            {v.rooms.map((x, i) => (
              <div className="row" key={i}>
                <div className="field" style={{ flex: 1 }}>
                  <label htmlFor={`rm${i}`}>Habitación</label>
                  <select
                    id={`rm${i}`}
                    value={x.roomId}
                    onChange={(e) => setRoom(i, { roomId: e.target.value })}
                  >
                    <option value="">Elegir…</option>
                    {inventory.map((q) => (
                      <option
                        key={q.id}
                        value={q.id}
                        disabled={used.has(q.id) && q.id !== x.roomId}
                      >
                        Hab. {q.roomNumber} · {categoryLabel(q.categoryRoom)}{' '}
                        (cap. {q.maxCapacity})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field" style={{ minWidth: 100 }}>
                  <label htmlFor={`gc${i}`}>Personas</label>
                  <input
                    id={`gc${i}`}
                    type="number"
                    min={1}
                    value={Number.isNaN(x.guestCount) ? '' : x.guestCount}
                    onChange={(e) =>
                      setRoom(i, { guestCount: parseInt(e.target.value, 10) })
                    }
                  />
                </div>
                <button
                  className="btn sm danger"
                  onClick={() =>
                    setV({ ...v, rooms: v.rooms.filter((_, j) => j !== i) })
                  }
                  disabled={v.rooms.length === 1}
                  title={
                    v.rooms.length === 1
                      ? 'La reserva debe conservar al menos una habitación'
                      : ''
                  }
                >
                  Quitar
                </button>
              </div>
            ))}
            <button
              className="btn sm"
              disabled={v.rooms.length >= 10}
              onClick={() =>
                setV({
                  ...v,
                  rooms: [...v.rooms, { roomId: '', guestCount: 1 }],
                })
              }
            >
              + Agregar habitación
            </button>

            <h3 style={{ margin: '18px 0 8px', fontSize: 14 }}>Titular</h3>
            <div className="row">
              <div className="field" style={{ flex: 1 }}>
                <label className="req" htmlFor="fn">
                  Nombres
                </label>
                <input
                  id="fn"
                  value={v.guest.firstName}
                  onChange={setG('firstName')}
                />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label className="req" htmlFor="ln">
                  Apellidos
                </label>
                <input
                  id="ln"
                  value={v.guest.lastName}
                  onChange={setG('lastName')}
                />
              </div>
            </div>
            <div className="row">
              <div className="field">
                <label htmlFor="dt">Tipo de documento</label>
                <select
                  id="dt"
                  value={v.guest.documentType}
                  onChange={setG('documentType')}
                >
                  {DOC_TYPES.map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="dn">No. documento</label>
                <input
                  id="dn"
                  value={v.guest.documentNumber}
                  onChange={setG('documentNumber')}
                />
              </div>
              <div className="field">
                <label htmlFor="na">País de origen</label>
                <input
                  id="na"
                  value={r.guest.nationality ?? ''}
                  disabled
                  title="La nacionalidad se fija al crear la reserva"
                />
              </div>
            </div>
            <div className="row">
              <div className="field">
                <label htmlFor="ph">Teléfono</label>
                <input
                  id="ph"
                  value={v.guest.contactPhone}
                  onChange={setG('contactPhone')}
                />
              </div>
              <div className="field">
                <label htmlFor="em">Email</label>
                <input
                  id="em"
                  value={v.guest.contactEmail}
                  onChange={setG('contactEmail')}
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="nt">Observaciones</label>
              <textarea
                id="nt"
                rows={2}
                maxLength={500}
                value={v.notes}
                onChange={(e) => setV({ ...v, notes: e.target.value })}
              />
            </div>
            {clientError && (
              <div className="field" role="alert">
                <span className="err">{clientError}</span>
              </div>
            )}
          </div>

          <div>
            <div className="panel" style={{ margin: '0 0 12px' }}>
              <h2>Resumen del cambio</h2>
              <div className="note" aria-live="polite">
                {clientError ? (
                  'Corrija los datos para ver el resumen.'
                ) : !request ? (
                  'Sin cambios todavía.'
                ) : preview.isFetching && !preview.data ? (
                  'Consultando…'
                ) : preview.error ? (
                  <span className="err">{preview.error.message}</span>
                ) : c ? (
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {c.dates && (
                      <li>
                        Cambian las fechas (
                        {preview.data!.reservation.startDate} →{' '}
                        {preview.data!.reservation.endDate}).
                      </li>
                    )}
                    {c.roomsAdded.length > 0 && (
                      <li>Se agregan {c.roomsAdded.length} habitación(es).</li>
                    )}
                    {c.roomsRemoved.length > 0 && (
                      <li>Se quitan {c.roomsRemoved.length} habitación(es).</li>
                    )}
                    {c.roomsSwapped.length > 0 && (
                      <li>
                        Se cambian {c.roomsSwapped.length} habitación(es).
                      </li>
                    )}
                    {c.guestCountChanged && (
                      <li>
                        Cambian las personas (
                        {preview.data!.reservation.guestCount} en total).
                      </li>
                    )}
                    {c.guestChanged && (
                      <li>Se corrigen los datos del titular.</li>
                    )}
                    {c.notesChanged && <li>Cambian las observaciones.</li>}
                  </ul>
                ) : null}
              </div>
            </div>
            <div className="panel" style={{ margin: '0 0 12px' }}>
              <h2>Tarifa</h2>
              <div className="calcbox">
                {preview.data && request && !clientError ? (
                  preview.data.quotes ? (
                    <>
                      {preview.data.quotes.rooms.map((q) => (
                        <div className="line" key={q.key}>
                          <span>
                            Hab. {byId.get(q.key)?.roomNumber} · {q.nights}{' '}
                            {q.nights === 1 ? 'noche' : 'noches'}
                          </span>
                          <span>{formatMoney(q.lodgingAmount)}</span>
                        </div>
                      ))}
                      <div className="total">
                        <span>Total hospedaje</span>
                        <span>{formatMoney(preview.data.quotes.total)}</span>
                      </div>
                      <p className="note" style={{ marginTop: 8 }}>
                        Solo se recotiza lo que cambió. El servidor confirma la
                        tarifa al guardar.
                      </p>
                    </>
                  ) : (
                    <p className="note">Este cambio no modifica la tarifa.</p>
                  )
                ) : (
                  <p className="note">
                    La tarifa aparece al haber un cambio válido.
                  </p>
                )}
              </div>
            </div>
            {save.error && <ErrorBox error={save.error} />}
            {concurrent && (
              <button
                className="btn"
                onClick={() =>
                  qc.invalidateQueries({
                    queryKey: ['reservation', r.reservationRef],
                  })
                }
              >
                Recargar la reserva
              </button>
            )}
            <div className="row" style={{ marginTop: 12 }}>
              <button
                className="btn primary"
                disabled={!canSave}
                onClick={() => save.mutate()}
              >
                {save.isPending ? 'Guardando…' : 'Guardar cambios'}
              </button>
              <Link className="btn" to={`/reservas/${r.reservationRef}`}>
                Volver sin guardar
              </Link>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
