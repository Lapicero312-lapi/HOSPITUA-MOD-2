import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ErrorBox } from '../components/Badges';
import { ApiError } from '../services/api-client.ts';
import {
  createDirect,
  getDaySummary,
  listRooms,
  lookupGuest,
  previewDirect,
} from '../services/reservations';
import type { DirectCreateRequest, GuestInput } from '../types';
import { addDays, categoryLabel, formatMoney } from '../utils/format';
import { validateDirectForm } from '../utils/directForm';
import { useDebounced } from '../utils/useDebounced';

const DOC_TYPES: [string, string][] = [
  ['RC', 'Registro Civil'],
  ['TI', 'Tarjeta de Identidad'],
  ['CC', 'Cédula de ciudadanía'],
  ['CE', 'Cédula de extranjería'],
  ['PAS', 'Pasaporte'],
  ['NIT', 'NIT'],
];
const EMPTY: GuestInput = {
  firstName: '',
  lastName: '',
  documentType: 'CC',
  documentNumber: '',
  nationality: '',
  contactPhone: '',
  contactEmail: '',
};

export default function NewDirectReservationPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const summary = useQuery({
    queryKey: ['day-summary'],
    queryFn: getDaySummary,
  });
  const rooms = useQuery({ queryKey: ['rooms'], queryFn: listRooms });
  const today = summary.data?.operationalDate ?? '';
  const categories = useMemo(
    () => [...new Set(rooms.data?.items.map((r) => r.categoryRoom))],
    [rooms.data],
  );

  const [guest, setGuest] = useState<GuestInput>(EMPTY);
  const [notes, setNotes] = useState('');
  const [startDateInput, setStartDate] = useState('');
  const [endDateInput, setEndDate] = useState('');
  const [categoryInput, setCategory] = useState('');
  const startDate = startDateInput || today;
  const endDate = endDateInput || (today ? addDays(today, 3) : '');
  const category = categoryInput || categories[0] || '';
  const [guestCounts, setGuestCounts] = useState<number[]>([2]);
  const [lookupMsg, setLookupMsg] = useState<string | null>(null);
  const idemKey = useRef(crypto.randomUUID()); // una Idempotency-Key por formulario (FR-008)

  const clientError = today
    ? validateDirectForm(
        { startDate, endDate, categoryRoom: category, guestCounts },
        today,
      )
    : 'Cargando…';
  const request = useMemo(
    () => ({
      startDate,
      endDate,
      categoryRoom: category,
      rooms: guestCounts.map((guestCount) => ({ guestCount })),
    }),
    [startDate, endDate, category, guestCounts],
  );
  const debounced = useDebounced(request);
  const preview = useQuery({
    queryKey: ['direct-preview', debounced],
    queryFn: () => previewDirect(debounced),
    enabled: !clientError && debounced === request,
    retry: false,
  });

  const lookup = useMutation({
    mutationFn: () =>
      lookupGuest(guest.documentType, guest.documentNumber.trim()),
    onSuccess: (r) => {
      if (r.found && r.guest) {
        setGuest({
          ...EMPTY,
          ...r.guest,
          nationality: r.guest.nationality ?? '',
          contactPhone: r.guest.contactPhone ?? '',
          contactEmail: r.guest.contactEmail ?? '',
        });
        setLookupMsg('Datos del titular cargados de su reserva más reciente.');
      } else
        setLookupMsg(
          'No hay reservas con ese documento: escriba los datos del titular.',
        );
    },
    onError: (e: Error) => setLookupMsg(e.message),
  });

  const create = useMutation({
    mutationFn: (body: DirectCreateRequest) =>
      createDirect(body, idemKey.current),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['reservations'] });
      qc.invalidateQueries({ queryKey: ['day-summary'] });
      nav(`/reservas/${r.reservationRef}`);
    },
    onError: (e) => {
      if (
        e instanceof ApiError &&
        ['RATE_CHANGED', 'NO_AVAILABILITY'].includes(e.errorCode)
      )
        preview.refetch();
    }, // vuelve a cotizar
  });

  const guestOk = [
    'firstName',
    'lastName',
    'documentNumber',
    'nationality',
  ].every((k) => String(guest[k as keyof GuestInput]).trim());
  const canSubmit =
    !!preview.data &&
    !clientError &&
    guestOk &&
    !create.isPending &&
    debounced === request;
  const submit = () => {
    if (!preview.data) return;
    create.mutate({
      ...request,
      notes: notes.trim() || undefined,
      guest: {
        ...guest,
        firstName: guest.firstName.trim(),
        lastName: guest.lastName.trim(),
        documentNumber: guest.documentNumber.trim(),
        nationality: guest.nationality.trim(),
        contactPhone: guest.contactPhone?.trim() || undefined,
        contactEmail: guest.contactEmail?.trim() || undefined,
      },
      expectedRates: preview.data.quotes.rooms.map((q) => ({
        position: Number(q.key),
        lodgingAmount: q.lodgingAmount.amount,
      })), // lo que vio la Recepcionista; el servidor vuelve a cotizar
    });
  };
  const setG = (k: keyof GuestInput) => (e: { target: { value: string } }) =>
    setGuest({ ...guest, [k]: e.target.value });
  const setQty = (n: number) =>
    setGuestCounts((c) =>
      Array.from({ length: Math.max(0, Math.min(10, n)) }, (_, i) => c[i] ?? 2),
    );

  return (
    <>
      <Link className="crumbnav" to="/reservas">
        ← Volver a reservas
      </Link>
      <div className="panel" style={{ marginTop: 10 }}>
        <h2>Nueva reserva directa</h2>
        <div className="grid2">
          <div>
            <div className="row">
              <div className="field" style={{ flex: 1 }}>
                <label className="req" htmlFor="dt">
                  Tipo de documento
                </label>
                <select
                  id="dt"
                  value={guest.documentType}
                  onChange={setG('documentType')}
                >
                  {DOC_TYPES.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label className="req" htmlFor="dn">
                  No. documento
                </label>
                <input
                  id="dn"
                  value={guest.documentNumber}
                  onChange={setG('documentNumber')}
                  placeholder="Sin puntos"
                />
              </div>
              <button
                className="btn"
                disabled={!guest.documentNumber.trim() || lookup.isPending}
                onClick={() => lookup.mutate()}
              >
                Buscar titular
              </button>
            </div>
            {lookupMsg && (
              <p className="note" role="status" style={{ marginBottom: 12 }}>
                {lookupMsg}
              </p>
            )}
            <div className="row">
              <div className="field" style={{ flex: 1 }}>
                <label className="req" htmlFor="fn">
                  Nombres
                </label>
                <input
                  id="fn"
                  value={guest.firstName}
                  onChange={setG('firstName')}
                />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label className="req" htmlFor="ln">
                  Apellidos
                </label>
                <input
                  id="ln"
                  value={guest.lastName}
                  onChange={setG('lastName')}
                />
              </div>
            </div>
            <div className="row">
              <div className="field">
                <label htmlFor="ph">Teléfono</label>
                <input
                  id="ph"
                  value={guest.contactPhone}
                  onChange={setG('contactPhone')}
                  placeholder="+57 300 000 0000"
                />
              </div>
              <div className="field">
                <label htmlFor="em">Email</label>
                <input
                  id="em"
                  value={guest.contactEmail}
                  onChange={setG('contactEmail')}
                  placeholder="nombre@correo.com"
                />
              </div>
            </div>
            <div className="row">
              <div className="field" style={{ flex: 1 }}>
                <label className="req" htmlFor="na">
                  País de origen
                </label>
                <input
                  id="na"
                  value={guest.nationality}
                  onChange={setG('nationality')}
                  placeholder="Ej. Colombia"
                />
              </div>
            </div>

            <div className="row">
              <div className="field">
                <label className="req" htmlFor="ct">
                  Categoría
                </label>
                <select
                  id="ct"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {categoryLabel(c)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field" style={{ minWidth: 110 }}>
                <label className="req" htmlFor="qty">
                  Habitaciones
                </label>
                <input
                  id="qty"
                  type="number"
                  min={1}
                  max={10}
                  value={guestCounts.length}
                  onChange={(e) => setQty(parseInt(e.target.value, 10) || 0)}
                />
              </div>
            </div>
            <div className="row">
              {guestCounts.map((n, i) => (
                <div className="field" style={{ minWidth: 110 }} key={i}>
                  <label htmlFor={`g${i}`}>Personas hab. {i + 1}</label>
                  <input
                    id={`g${i}`}
                    type="number"
                    min={1}
                    value={Number.isNaN(n) ? '' : n}
                    onChange={(e) =>
                      setGuestCounts((c) =>
                        c.map((x, j) =>
                          j === i ? parseInt(e.target.value, 10) : x,
                        ),
                      )
                    }
                  />
                </div>
              ))}
            </div>
            <div className="row">
              <div className="field">
                <label className="req" htmlFor="sd">
                  Fecha de entrada
                </label>
                <input
                  id="sd"
                  type="date"
                  min={today}
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="field">
                <label className="req" htmlFor="ed">
                  Fecha de salida
                </label>
                <input
                  id="ed"
                  type="date"
                  min={startDate || today}
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
            </div>
            {clientError && today && (
              <div className="field" role="alert">
                <span className="err">{clientError}</span>
              </div>
            )}
            <div className="field">
              <label htmlFor="nt">Observaciones</label>
              <textarea
                id="nt"
                rows={2}
                maxLength={500}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Opcional, máximo 500 caracteres"
              />
            </div>
          </div>

          <div>
            <div className="panel" style={{ margin: '0 0 12px' }}>
              <h2>Disponibilidad</h2>
              <div className="note" aria-live="polite">
                {clientError ? (
                  <>
                    <span className="badge neutral">Sin verificar</span> corrija
                    los datos para consultar disponibilidad.
                  </>
                ) : preview.isFetching && !preview.data ? (
                  'Consultando…'
                ) : preview.error ? (
                  <>
                    <span
                      className={`badge ${(preview.error as ApiError).errorCode === 'NO_AVAILABILITY' ? 'err' : 'warn'}`}
                    >
                      {(preview.error as ApiError).errorCode ===
                      'NO_AVAILABILITY'
                        ? 'Sin disponibilidad'
                        : 'No se pudo verificar'}
                    </span>{' '}
                    {preview.error.message}
                  </>
                ) : preview.data ? (
                  <>
                    <span className="badge ok">Disponible</span>{' '}
                    {preview.data.assignedRooms
                      .map((a) => `Hab. ${a.roomNumber}`)
                      .join(', ')}{' '}
                    · {preview.data.availability.availableCount} libre(s) en{' '}
                    {categoryLabel(category)}.
                  </>
                ) : null}
              </div>
            </div>
            <div className="panel" style={{ margin: '0 0 12px' }}>
              <h2>Tarifa</h2>
              <div className="calcbox">
                {preview.data && !clientError ? (
                  <>
                    {preview.data.quotes.rooms.map((q, i) => (
                      <div className="line" key={q.key}>
                        <span>
                          Hab. {preview.data!.assignedRooms[i].roomNumber} ·{' '}
                          {q.nights} {q.nights === 1 ? 'noche' : 'noches'}
                        </span>
                        <span>{formatMoney(q.lodgingAmount)}</span>
                      </div>
                    ))}
                    <div className="total">
                      <span>Total hospedaje</span>
                      <span>{formatMoney(preview.data.quotes.total)}</span>
                    </div>
                    <p className="note" style={{ marginTop: 8 }}>
                      Sin cobro: el pago se hace en el Check-Out. El servidor
                      confirma la tarifa al crear.
                    </p>
                  </>
                ) : (
                  <p className="note">Ingrese datos válidos para cotizar.</p>
                )}
              </div>
            </div>
            {create.error && <ErrorBox error={create.error} />}
            <div className="row">
              <button
                className="btn primary"
                disabled={!canSubmit}
                title={
                  guestOk
                    ? ''
                    : 'Complete nombres, apellidos, documento y país del titular'
                }
                onClick={submit}
              >
                {create.isPending ? 'Creando…' : 'Crear reserva'}
              </button>
              <Link className="btn" to="/reservas">
                Volver
              </Link>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
