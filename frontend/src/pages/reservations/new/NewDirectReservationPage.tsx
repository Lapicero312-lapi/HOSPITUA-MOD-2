import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { ErrorMessage } from '../../../components/ErrorMessage.tsx';
import {
  createDirectReservation,
  DOCUMENT_TYPES,
  lookupGuest,
  MAX_NOTES_LENGTH,
  MAX_ROOMS,
  previewDirectReservation,
  type DirectCreationRequest,
  type DirectPreview,
  type DirectPreviewRequest,
  type Money,
} from '../../../services/direct-reservation.ts';
import { listRooms } from '../../../services/rooms.ts';
import './NewDirectReservationPage.css';

/** El titular tal como se escribe en el formulario. */
type GuestForm = {
  firstName: string;
  lastName: string;
  documentType: string;
  documentNumber: string;
  nationality: string;
  contactPhone: string;
  contactEmail: string;
};

const EMPTY_GUEST: GuestForm = {
  firstName: '',
  lastName: '',
  documentType: 'CC',
  documentNumber: '',
  nationality: '',
  contactPhone: '',
  contactEmail: '',
};

/**
 * Pantalla "Nueva reserva directa" (plan de `generate-direct-reservation`, T014; wireframe `scr-nueva-directa`):
 * - la disponibilidad y la tarifa de cada habitación se piden solas a la vista previa (A) cada vez que
 *   cambian las fechas, la categoría o las habitaciones;
 * - el titular se puede precargar por su documento (E);
 * - "Crear reserva" envía la creación (B) con las tarifas que se vieron y una `Idempotency-Key` por
 *   solicitud, y abre el detalle de la reserva creada.
 *
 * Las reglas las aplica el backend: su mensaje se muestra tal cual.
 */
export function NewDirectReservationPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [categoryRoom, setCategoryRoom] = useState('');
  const [guestCounts, setGuestCounts] = useState<number[]>([2]);
  const [guest, setGuest] = useState<GuestForm>(EMPTY_GUEST);
  const [notes, setNotes] = useState('');

  // Las categorías salen del inventario del Módulo 1 (`GET /api/rooms`).
  const rooms = useQuery({
    queryKey: ['rooms'],
    queryFn: ({ signal }) => listRooms(signal),
  });
  const categories = useMemo(
    () =>
      [...new Set((rooms.data?.items ?? []).map((r) => r.categoryRoom))].sort(),
    [rooms.data],
  );

  const stay: DirectPreviewRequest = useMemo(
    () => ({
      startDate,
      endDate,
      categoryRoom,
      rooms: guestCounts.map((guestCount) => ({ guestCount })),
    }),
    [startDate, endDate, categoryRoom, guestCounts],
  );
  const ready =
    startDate !== '' &&
    endDate !== '' &&
    categoryRoom !== '' &&
    guestCounts.every((count) => Number.isInteger(count) && count >= 1);

  // La vista previa (A), sola al cambiar las fechas, la categoría o las habitaciones (T014).
  const preview = useQuery({
    queryKey: ['reservations', 'direct-preview', stay],
    queryFn: ({ signal }) => previewDirectReservation(stay, signal),
    enabled: ready,
    retry: false,
    placeholderData: keepPreviousData,
  });

  const creationBody = (shown: DirectPreview): DirectCreationRequest => ({
    ...stay,
    guest: {
      firstName: guest.firstName.trim(),
      lastName: guest.lastName.trim(),
      documentType: guest.documentType,
      documentNumber: guest.documentNumber.trim(),
      nationality: guest.nationality.trim(),
      contactPhone: emptyAsNull(guest.contactPhone),
      contactEmail: emptyAsNull(guest.contactEmail),
    },
    notes: emptyAsNull(notes),
    expectedRates: shown.quotes.rooms.map(({ key, lodgingAmount }) => ({
      position: Number(key),
      lodgingAmount: lodgingAmount.amount,
      currency: lodgingAmount.currency,
    })),
  });

  // Una `Idempotency-Key` por solicitud: la misma si se reintenta lo mismo, otra si cambia algo (FR-008).
  const submission = JSON.stringify({
    stay,
    guest,
    notes,
    quotes: preview.data?.quotes,
  });
  const idempotencyKey = useMemo(() => {
    void submission;
    return crypto.randomUUID();
  }, [submission]);

  const creation = useMutation({
    mutationFn: (body: DirectCreationRequest) =>
      createDirectReservation(body, idempotencyKey),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: ['reservations'] });
      await navigate(`/reservas/${created.reservationRef}`);
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (
      preview.isSuccess &&
      !preview.isPlaceholderData &&
      !creation.isPending
    ) {
      creation.mutate(creationBody(preview.data));
    }
  };

  const setRoomGuests = (index: number, value: string) =>
    setGuestCounts((counts) =>
      counts.map((count, i) => (i === index ? Number(value) : count)),
    );

  return (
    <section className="new-direct">
      <Link className="new-direct-back" to="/reservas">
        ← Volver a reservas
      </Link>
      <h1 className="new-direct-title">Nueva reserva directa</h1>
      <form className="new-direct-grid" onSubmit={submit} noValidate>
        <div className="new-direct-panel">
          <h2>Estadía</h2>
          <div className="new-direct-row">
            <Field id="nd-start" label="Fecha de entrada">
              <input
                id="nd-start"
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
              />
            </Field>
            <Field id="nd-end" label="Fecha de salida">
              <input
                id="nd-end"
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
              />
            </Field>
            <Field id="nd-category" label="Categoría">
              <select
                id="nd-category"
                value={categoryRoom}
                onChange={(event) => setCategoryRoom(event.target.value)}
              >
                <option value="">Elegir…</option>
                {categories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {rooms.isError && <ErrorMessage error={rooms.error} />}

          <h2>Habitaciones</h2>
          <ol className="new-direct-rooms">
            {guestCounts.map((count, index) => (
              // La posición es la identidad de la habitación en la solicitud (A y B).
              <li key={index} className="new-direct-room">
                <label htmlFor={`nd-guests-${index}`}>
                  Personas en la habitación {index + 1}
                </label>
                <input
                  id={`nd-guests-${index}`}
                  type="number"
                  min={1}
                  value={count}
                  onChange={(event) => setRoomGuests(index, event.target.value)}
                />
                {guestCounts.length > 1 && (
                  <button
                    type="button"
                    onClick={() =>
                      setGuestCounts((counts) =>
                        counts.filter((_, i) => i !== index),
                      )
                    }
                  >
                    Quitar
                  </button>
                )}
              </li>
            ))}
          </ol>
          {guestCounts.length < MAX_ROOMS && (
            <button
              type="button"
              onClick={() => setGuestCounts((counts) => [...counts, 1])}
            >
              + Agregar habitación
            </button>
          )}

          <h2>Titular</h2>
          <Holder guest={guest} onChange={setGuest} />

          <Field id="nd-notes" label="Observaciones (opcional)">
            <textarea
              id="nd-notes"
              rows={2}
              maxLength={MAX_NOTES_LENGTH}
              value={notes}
              placeholder="Máximo 500 caracteres"
              onChange={(event) => setNotes(event.target.value)}
            />
          </Field>
        </div>

        <div className="new-direct-panel">
          <h2>Disponibilidad y tarifa</h2>
          {!ready && (
            <p className="new-direct-hint">
              Elija las fechas, la categoría y las personas de cada habitación.
            </p>
          )}
          {ready && preview.isFetching && (
            <p className="new-direct-hint">Consultando disponibilidad…</p>
          )}
          {ready && preview.isError && <ErrorMessage error={preview.error} />}
          {ready && preview.isSuccess && <Quote preview={preview.data} />}
          {creation.isError && <ErrorMessage error={creation.error} />}
          <div className="new-direct-buttons">
            <button
              type="submit"
              disabled={
                !ready ||
                !preview.isSuccess ||
                preview.isPlaceholderData ||
                creation.isPending
              }
            >
              {creation.isPending ? 'Creando…' : 'Crear reserva'}
            </button>
            <Link to="/reservas">Volver</Link>
          </div>
        </div>
      </form>
    </section>
  );
}

/** El titular, con la precarga por documento (E). */
function Holder({
  guest,
  onChange,
}: {
  guest: GuestForm;
  onChange: (guest: GuestForm) => void;
}) {
  const lookup = useMutation({
    mutationFn: () =>
      lookupGuest(guest.documentType, guest.documentNumber.trim()),
    onSuccess: (result) => {
      if (result.found) {
        onChange({
          firstName: result.guest.firstName,
          lastName: result.guest.lastName,
          documentType: result.guest.documentType,
          documentNumber: result.guest.documentNumber,
          nationality: result.guest.nationality,
          contactPhone: result.guest.contactPhone ?? '',
          contactEmail: result.guest.contactEmail ?? '',
        });
      }
    },
  });
  const set = (field: keyof GuestForm) => (value: string) =>
    onChange({ ...guest, [field]: value });

  return (
    <>
      <div className="new-direct-row">
        <Field id="nd-doc-type" label="Tipo de documento">
          <select
            id="nd-doc-type"
            value={guest.documentType}
            onChange={(event) => set('documentType')(event.target.value)}
          >
            {DOCUMENT_TYPES.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field id="nd-doc" label="No. documento">
          <input
            id="nd-doc"
            value={guest.documentNumber}
            onChange={(event) => set('documentNumber')(event.target.value)}
          />
        </Field>
        <button
          type="button"
          className="new-direct-lookup"
          disabled={guest.documentNumber.trim() === '' || lookup.isPending}
          onClick={() => lookup.mutate()}
        >
          Buscar titular
        </button>
      </div>
      {lookup.isError && <ErrorMessage error={lookup.error} />}
      {lookup.isSuccess && (
        <p role="status" className="new-direct-hint">
          {lookup.data.found
            ? 'Se precargaron los datos de la última reserva con ese documento.'
            : 'No hay reservas con ese documento: escriba los datos del titular.'}
        </p>
      )}
      <div className="new-direct-row">
        <Field id="nd-first" label="Nombres">
          <input
            id="nd-first"
            value={guest.firstName}
            onChange={(event) => set('firstName')(event.target.value)}
          />
        </Field>
        <Field id="nd-last" label="Apellidos">
          <input
            id="nd-last"
            value={guest.lastName}
            onChange={(event) => set('lastName')(event.target.value)}
          />
        </Field>
        <Field id="nd-country" label="País de origen">
          <input
            id="nd-country"
            value={guest.nationality}
            placeholder="Ej. Colombia"
            onChange={(event) => set('nationality')(event.target.value)}
          />
        </Field>
      </div>
      <div className="new-direct-row">
        <Field id="nd-phone" label="Teléfono (opcional)">
          <input
            id="nd-phone"
            value={guest.contactPhone}
            placeholder="+57 300 000 0000"
            onChange={(event) => set('contactPhone')(event.target.value)}
          />
        </Field>
        <Field id="nd-email" label="Email (opcional)">
          <input
            id="nd-email"
            type="email"
            value={guest.contactEmail}
            placeholder="nombre@correo.com"
            onChange={(event) => set('contactEmail')(event.target.value)}
          />
        </Field>
      </div>
    </>
  );
}

/** Las habitaciones asignadas, la tarifa de cada una y el total (A). */
function Quote({ preview }: { preview: DirectPreview }) {
  const byPosition = new Map(
    preview.quotes.rooms.map((room) => [Number(room.key), room]),
  );
  return (
    <>
      <p className="new-direct-available">
        {preview.availability.availableCount} habitaciones{' '}
        {preview.availability.categoryRoom} disponibles.
      </p>
      <table className="new-direct-table">
        <thead>
          <tr>
            <th scope="col">Habitación</th>
            <th scope="col">Personas</th>
            <th scope="col">Noches</th>
            <th scope="col">Tarifa</th>
          </tr>
        </thead>
        <tbody>
          {preview.assignedRooms.map((room) => {
            const quote = byPosition.get(room.position);
            return (
              <tr key={room.position}>
                <td>{room.roomNumber}</td>
                <td>{room.guestCount}</td>
                <td>{quote?.nights ?? '—'}</td>
                <td className="new-direct-money">
                  {quote === undefined ? '—' : formatMoney(quote.lodgingAmount)}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" colSpan={3}>
              Total
            </th>
            <td className="new-direct-money">
              {formatMoney(preview.quotes.total)}
            </td>
          </tr>
        </tfoot>
      </table>
    </>
  );
}

function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="new-direct-field">
      <label htmlFor={id}>{label}</label>
      {children}
    </div>
  );
}

/** `750000.00 COP` como `750.000,00 COP`: puntos de miles y coma decimal, sin pasar por un número. */
function formatMoney(money: Money): string {
  const [whole, decimals = '00'] = money.amount.split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${decimals} ${money.currency}`;
}

function emptyAsNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}
