import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ErrorMessage } from '../../../components/ErrorMessage.tsx';
import { ApiError } from '../../../services/api-client.ts';
import {
  confirmModification,
  DOCUMENT_TYPES,
  getReservationToModify,
  MAX_NOTES_LENGTH,
  MAX_ROOMS,
  previewModification,
  type ModificationConfirmation,
  type ModificationPreview,
  type ModificationRequest,
  type ModifiedGuest,
  type Money,
  type RequestedRoom,
  type ReservationToModify,
} from '../../../services/reservation-modification.ts';
import { listRooms, type Room } from '../../../services/rooms.ts';
import './ModifyReservationPage.css';

/** Los mensajes de la tabla de B para lo que la pantalla ya sabe antes de enviar. */
const OTA_MESSAGE =
  'Las reservas de OTA solo las modifica Booking. Si está en conflicto, solo se le puede asignar la habitación.';
const STATUS_MESSAGE =
  'El estado actual de la reserva no admite modificaciones.';

/**
 * Los errores de B2 que obligan a volver a pedir la vista previa: la tarifa o la disponibilidad que se
 * vieron ya no valen. Los demás se reintentan con lo mismo.
 */
const REQUOTE_ERRORS = new Set(['RATE_CHANGED', 'ROOM_NOT_AVAILABLE']);

/** El motivo de una habitación no disponible de B1 (`VerifyAvailability`), en palabras. */
const UNAVAILABLE_REASONS: Record<'RESERVED' | 'MAINTENANCE', string> = {
  RESERVED: 'Reservada en esas fechas',
  MAINTENANCE: 'En mantenimiento',
};

/** Solo una reserva `PENDING` o `ACTIVE` se puede modificar (`STATUS_NOT_EDITABLE`). */
const EDITABLE = new Set(['PENDING', 'ACTIVE']);

/** El titular tal como se escribe en el formulario: sin la nacionalidad, que no cambia. */
type GuestForm = {
  firstName: string;
  lastName: string;
  documentType: string;
  documentNumber: string;
  contactPhone: string;
  contactEmail: string;
};

/**
 * Pantalla "Modificar" (plan de `update-reservation`, T014 y B; wireframe `scr-modificar`):
 * - el formulario empieza con los datos de la reserva (C3) y solo envía lo que cambió, con el `updatedAt`
 *   que leyó;
 * - la disponibilidad y la tarifa se piden solas a la vista previa (B1) cada vez que algo cambia;
 * - "Guardar cambios" confirma (B2) con las tarifas que se vieron y vuelve al detalle.
 *
 * Las reglas las aplica el backend: su mensaje se muestra tal cual.
 */
export function ModifyReservationPage() {
  const { reservationRef = '' } = useParams();
  const reservation = useQuery({
    queryKey: ['reservations', 'to-modify', reservationRef],
    queryFn: ({ signal }) => getReservationToModify(reservationRef, signal),
  });

  return (
    <section className="modify ui-page">
      <Link className="modify-back ui-back" to={`/reservas/${reservationRef}`}>
        ← Volver al detalle
      </Link>
      <h1 className="modify-title ui-page-title">
        Modificar reserva {reservationRef}
      </h1>
      {reservation.isPending && (
        <p className="modify-hint modify-loading ui-panel ui-state ui-state--loading">
          Cargando reserva…
        </p>
      )}
      {reservation.isError && (
        <div className="modify-panel ui-panel">
          <ErrorMessage error={reservation.error} />
        </div>
      )}
      {reservation.isSuccess && (
        // Con otro `updatedAt` (se volvió a leer), el formulario empieza de nuevo con los datos de ahora.
        <Modification
          key={reservation.data.updatedAt}
          reservation={reservation.data}
          onReload={() => void reservation.refetch()}
        />
      )}
    </section>
  );
}

function Modification({
  reservation,
  onReload,
}: {
  reservation: ReservationToModify;
  onReload: () => void;
}) {
  const blocked =
    reservation.source === 'OTA'
      ? OTA_MESSAGE
      : EDITABLE.has(reservation.status)
        ? null
        : STATUS_MESSAGE;
  if (blocked !== null) {
    return (
      <div className="modify-panel ui-panel">
        <p role="alert" className="error-message">
          {blocked}
        </p>
      </div>
    );
  }
  return <ModificationForm reservation={reservation} onReload={onReload} />;
}

function ModificationForm({
  reservation,
  onReload,
}: {
  reservation: ReservationToModify;
  onReload: () => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { reservationRef } = reservation;
  const originalRooms = useMemo(() => roomsOf(reservation), [reservation]);
  const originalGuest = useMemo(() => guestOf(reservation), [reservation]);

  const [startDate, setStartDate] = useState(reservation.startDate);
  const [endDate, setEndDate] = useState(reservation.endDate);
  const [rooms, setRooms] = useState<RequestedRoom[]>(originalRooms);
  const [guest, setGuest] = useState<GuestForm>(originalGuest);
  const [notes, setNotes] = useState(reservation.notes ?? '');

  // Las habitaciones que se pueden elegir salen del inventario del Módulo 1 (`GET /api/rooms`).
  const inventory = useQuery({
    queryKey: ['rooms'],
    queryFn: ({ signal }) => listRooms(signal),
  });
  const choices = useMemo(
    () => roomChoices(reservation, inventory.data?.items ?? []),
    [reservation, inventory.data],
  );

  // Solo lo que cambió, con el `updatedAt` que leyó la pantalla: lo que no se envía queda igual (B).
  const change: ModificationRequest = useMemo(() => {
    const guestBody = trimmedGuest(guest);
    const notesBody = emptyAsNull(notes);
    return {
      updatedAt: reservation.updatedAt,
      ...(startDate !== reservation.startDate || endDate !== reservation.endDate
        ? { startDate, endDate }
        : {}),
      ...(sameRooms(rooms, originalRooms) ? {} : { rooms }),
      ...(sameGuest(guest, originalGuest) ? {} : { guest: guestBody }),
      ...(notesBody === reservation.notes ? {} : { notes: notesBody }),
    };
  }, [
    reservation,
    originalRooms,
    originalGuest,
    startDate,
    endDate,
    rooms,
    guest,
    notes,
  ]);
  const changed = Object.keys(change).length > 1;
  const complete =
    startDate !== '' &&
    endDate !== '' &&
    rooms.every(
      ({ roomId, guestCount }) =>
        roomId !== '' && Number.isInteger(guestCount) && guestCount >= 1,
    );
  const ready = changed && complete;

  // La vista previa (B1), sola cada vez que algo cambia (T014).
  const preview = useQuery({
    queryKey: ['reservations', 'modification-preview', reservationRef, change],
    queryFn: ({ signal }) =>
      previewModification(reservationRef, change, signal),
    enabled: ready,
    retry: false,
    placeholderData: keepPreviousData,
  });

  const confirmation = useMutation({
    mutationFn: (body: ModificationConfirmation) =>
      confirmModification(reservationRef, body),
    onSuccess: async () => {
      // El listado, el detalle y el resumen del día cambiaron.
      await queryClient.invalidateQueries({ queryKey: ['reservations'] });
      await navigate(`/reservas/${reservationRef}`);
    },
    onError: (error) => {
      if (error instanceof ApiError && REQUOTE_ERRORS.has(error.errorCode)) {
        void preview.refetch();
      }
    },
  });
  // Otra persona cambió la reserva: lo dice B1 o B2, y en los dos casos se ofrece volver a cargarla.
  const stale = [preview.error, confirmation.error].some(
    (error) =>
      error instanceof ApiError && error.errorCode === 'CONCURRENT_UPDATE',
  );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (
      ready &&
      preview.isSuccess &&
      !preview.isPlaceholderData &&
      !preview.isFetching &&
      !confirmation.isPending
    ) {
      confirmation.mutate({
        ...change,
        // Las tarifas que vio el solicitante: el servidor vuelve a cotizar y las compara (decisión D1).
        expectedRates: (preview.data.quotes?.rooms ?? []).map(
          ({ key, lodgingAmount }) => ({
            roomId: key,
            lodgingAmount: lodgingAmount.amount,
            currency: lodgingAmount.currency,
          }),
        ),
      });
    }
  };

  const setRoom = (index: number, room: Partial<RequestedRoom>) =>
    setRooms((current) =>
      current.map((r, i) => (i === index ? { ...r, ...room } : r)),
    );
  const verified = new Map(
    (preview.data?.availability.rooms ?? []).map((room) => [room.roomId, room]),
  );

  return (
    <form className="modify-grid" onSubmit={submit} noValidate>
      <div className="modify-panel ui-panel">
        <h2>Estadía</h2>
        <div className="modify-row">
          <Field id="md-start" label="Fecha de entrada">
            <input
              id="md-start"
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </Field>
          <Field id="md-end" label="Fecha de salida">
            <input
              id="md-end"
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
            />
          </Field>
        </div>

        <h2>Habitaciones</h2>
        <p className="modify-hint">
          Entre 1 y 10. Puede cambiar una por otra, de la misma o de otra
          categoría, agregar o quitar.
        </p>
        {inventory.isError && <ErrorMessage error={inventory.error} />}
        <table className="modify-table ui-table">
          <thead>
            <tr>
              <th scope="col">Habitación</th>
              <th scope="col">Categoría</th>
              <th scope="col">Personas</th>
              <th scope="col">Disponibilidad</th>
              <th scope="col">
                <span className="modify-hidden">Acciones</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rooms.map((room, index) => {
              const chosenElsewhere = new Set(
                rooms.filter((_, i) => i !== index).map((r) => r.roomId),
              );
              const check = verified.get(room.roomId);
              return (
                // La posición es la fila del formulario; la habitación se identifica por su `roomId`.
                <tr key={index}>
                  <td>
                    <select
                      aria-label={`Habitación ${index + 1}`}
                      value={room.roomId}
                      onChange={(event) =>
                        setRoom(index, { roomId: event.target.value })
                      }
                    >
                      <option value="">Elegir…</option>
                      {choices.map((choice) => (
                        <option
                          key={choice.id}
                          value={choice.id}
                          disabled={chosenElsewhere.has(choice.id)}
                        >
                          {choice.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {choices.find(({ id }) => id === room.roomId)
                      ?.categoryRoom ?? '—'}
                  </td>
                  <td>
                    <input
                      aria-label={`Personas en la habitación ${index + 1}`}
                      type="number"
                      min={1}
                      value={room.guestCount}
                      onChange={(event) =>
                        setRoom(index, {
                          guestCount: Number(event.target.value),
                        })
                      }
                    />
                  </td>
                  <td>
                    {check === undefined
                      ? '—'
                      : check.available
                        ? 'Disponible'
                        : check.reason === null
                          ? 'No disponible'
                          : UNAVAILABLE_REASONS[check.reason]}
                  </td>
                  <td>
                    {rooms.length > 1 && (
                      <button
                        type="button"
                        aria-label={`Quitar la habitación ${index + 1}`}
                        onClick={() =>
                          setRooms((current) =>
                            current.filter((_, i) => i !== index),
                          )
                        }
                      >
                        Quitar
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rooms.length < MAX_ROOMS && (
          <button
            type="button"
            className="modify-add"
            onClick={() =>
              setRooms((current) => [...current, { roomId: '', guestCount: 1 }])
            }
          >
            + Agregar habitación
          </button>
        )}

        <h2>Titular</h2>
        <Holder guest={guest} onChange={setGuest} />

        <Field id="md-notes" label="Observaciones (opcional)">
          <textarea
            id="md-notes"
            rows={2}
            maxLength={MAX_NOTES_LENGTH}
            value={notes}
            placeholder="Máximo 500 caracteres"
            onChange={(event) => setNotes(event.target.value)}
          />
        </Field>
      </div>

      <div className="modify-panel modify-aside ui-panel">
        <h2>Tarifa</h2>
        {!changed && <p className="modify-hint">No hay cambios.</p>}
        {changed && !complete && (
          <p className="modify-hint">
            Elija las dos fechas y una habitación con sus personas en cada fila.
          </p>
        )}
        {ready && preview.isFetching && (
          <p className="modify-hint">Consultando disponibilidad y tarifa…</p>
        )}
        {ready && preview.isError && <ErrorMessage error={preview.error} />}
        {ready && preview.isSuccess && (
          <Quote preview={preview.data} choices={choices} />
        )}
        {confirmation.isError && <ErrorMessage error={confirmation.error} />}
        {stale && (
          <button type="button" onClick={onReload}>
            Volver a cargar la reserva
          </button>
        )}
        <div className="modify-buttons">
          <button
            type="submit"
            className="ui-button--primary"
            disabled={
              !ready ||
              !preview.isSuccess ||
              preview.isPlaceholderData ||
              preview.isFetching ||
              confirmation.isPending
            }
          >
            {confirmation.isPending ? 'Guardando…' : 'Guardar cambios'}
          </button>
          <Link className="ui-link-button" to={`/reservas/${reservationRef}`}>
            Volver sin guardar
          </Link>
        </div>
      </div>
    </form>
  );
}

/** El titular: los datos que se pueden corregir (sin la nacionalidad). */
function Holder({
  guest,
  onChange,
}: {
  guest: GuestForm;
  onChange: (guest: GuestForm) => void;
}) {
  const set = (field: keyof GuestForm) => (value: string) =>
    onChange({ ...guest, [field]: value });
  return (
    <>
      <div className="modify-row">
        <Field id="md-first" label="Nombres">
          <input
            id="md-first"
            value={guest.firstName}
            onChange={(event) => set('firstName')(event.target.value)}
          />
        </Field>
        <Field id="md-last" label="Apellidos">
          <input
            id="md-last"
            value={guest.lastName}
            onChange={(event) => set('lastName')(event.target.value)}
          />
        </Field>
      </div>
      <div className="modify-row">
        <Field id="md-doc-type" label="Tipo de documento">
          <select
            id="md-doc-type"
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
        <Field id="md-doc" label="Documento">
          <input
            id="md-doc"
            value={guest.documentNumber}
            onChange={(event) => set('documentNumber')(event.target.value)}
          />
        </Field>
      </div>
      <div className="modify-row">
        <Field id="md-phone" label="Teléfono (opcional)">
          <input
            id="md-phone"
            value={guest.contactPhone}
            onChange={(event) => set('contactPhone')(event.target.value)}
          />
        </Field>
        <Field id="md-email" label="Email (opcional)">
          <input
            id="md-email"
            type="email"
            value={guest.contactEmail}
            onChange={(event) => set('contactEmail')(event.target.value)}
          />
        </Field>
      </div>
    </>
  );
}

/** Las habitaciones recotizadas con su tarifa y el total de la reserva como quedaría (B1). */
function Quote({
  preview,
  choices,
}: {
  preview: ModificationPreview;
  choices: RoomChoice[];
}) {
  const { quotes } = preview;
  return (
    <>
      <p className="modify-hint">
        Quedaría con {preview.reservation.guestCount} personas.
      </p>
      {quotes === null ? (
        <p className="modify-hint">La tarifa no cambia.</p>
      ) : (
        <table className="modify-table ui-table">
          <thead>
            <tr>
              <th scope="col">Habitación</th>
              <th scope="col">Noches</th>
              <th scope="col">Tarifa</th>
            </tr>
          </thead>
          <tbody>
            {quotes.rooms.map((room) => (
              <tr key={room.key}>
                <td>
                  {choices.find(({ id }) => id === room.key)?.roomNumber ??
                    room.key}
                </td>
                <td>{room.nights}</td>
                <td className="modify-money">
                  {formatMoney(room.lodgingAmount)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={2}>
                Total de la reserva
              </th>
              <td className="modify-money">{formatMoney(quotes.total)}</td>
            </tr>
          </tfoot>
        </table>
      )}
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
    <div className="modify-field">
      <label htmlFor={id}>{label}</label>
      {children}
    </div>
  );
}

/** Una habitación que se puede elegir en una fila. */
type RoomChoice = {
  id: string;
  roomNumber: string;
  categoryRoom: string;
  label: string;
};

/**
 * Las habitaciones del inventario, y las de la reserva que no estén en él (si el inventario no respondió,
 * las de la reserva siguen a la vista).
 */
function roomChoices(
  reservation: ReservationToModify,
  inventory: Room[],
): RoomChoice[] {
  const choices: RoomChoice[] = inventory.map((room) => ({
    id: room.id,
    roomNumber: room.roomNumber,
    categoryRoom: room.categoryRoom,
    label: `${room.roomNumber} · ${room.categoryRoom} · hasta ${room.maxCapacity} personas`,
  }));
  for (const room of reservation.rooms) {
    if (room.roomId !== null && !choices.some(({ id }) => id === room.roomId)) {
      const roomNumber = room.roomNumber ?? room.roomId;
      choices.push({
        id: room.roomId,
        roomNumber,
        categoryRoom: room.categoryRoom,
        label: `${roomNumber} · ${room.categoryRoom}`,
      });
    }
  }
  return choices;
}

function roomsOf(reservation: ReservationToModify): RequestedRoom[] {
  return reservation.rooms.map(({ roomId, guestCount }) => ({
    roomId: roomId ?? '',
    guestCount,
  }));
}

function guestOf({ guest }: ReservationToModify): GuestForm {
  return {
    firstName: guest.firstName,
    lastName: guest.lastName,
    documentType: guest.documentType ?? 'CC',
    documentNumber: guest.documentNumber ?? '',
    contactPhone: guest.contactPhone ?? '',
    contactEmail: guest.contactEmail ?? '',
  };
}

function sameRooms(a: RequestedRoom[], b: RequestedRoom[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (room, i) =>
        room.roomId === b[i].roomId && room.guestCount === b[i].guestCount,
    )
  );
}

function sameGuest(a: GuestForm, b: GuestForm): boolean {
  const left = trimmedGuest(a);
  const right = trimmedGuest(b);
  return (Object.keys(left) as (keyof ModifiedGuest)[]).every(
    (field) => left[field] === right[field],
  );
}

function trimmedGuest(guest: GuestForm): ModifiedGuest {
  return {
    firstName: guest.firstName.trim(),
    lastName: guest.lastName.trim(),
    documentType: guest.documentType,
    documentNumber: guest.documentNumber.trim(),
    contactPhone: emptyAsNull(guest.contactPhone),
    contactEmail: emptyAsNull(guest.contactEmail),
  };
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
