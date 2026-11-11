import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { ErrorMessage } from '../../../components/ErrorMessage.tsx';
import {
  cancelReservation,
  getReservationToCancel,
  MAX_REASON_LENGTH,
  type CancellationResult,
  type ReservationToCancel,
} from '../../../services/reservation-cancellation.ts';
import './CancelReservationPage.css';

/** Los mensajes de la tabla C de `cancel-reservation` para lo que la pantalla ya sabe antes de enviar. */
const OTA_MESSAGE =
  'La cancelación de una reserva de OTA debe llegar desde Booking.';
const STATUS_MESSAGE = 'El estado actual de la reserva no admite cancelación.';

/**
 * Pantalla "Cancelar reserva" (spec de `cancel-reservation`, FR-002b; plan, A): muestra la reserva, pide
 * marcar la casilla "Entiendo que la cancelación no se puede deshacer." y un motivo opcional, y cancela.
 * El botón solo se habilita con la casilla marcada; el servidor también la exige. Las demás reglas las
 * aplica el backend: su mensaje se muestra tal cual.
 */
export function CancelReservationPage() {
  const { reservationRef = '' } = useParams();
  const reservation = useQuery({
    queryKey: ['reservations', 'to-cancel', reservationRef],
    queryFn: ({ signal }) => getReservationToCancel(reservationRef, signal),
  });

  return (
    <section className="cancel">
      <Link className="cancel-back" to={`/reservas/${reservationRef}`}>
        ← Volver al detalle
      </Link>
      <h1 className="cancel-title">Cancelar reserva</h1>
      {reservation.isPending && (
        <p className="cancel-state cancel-state--loading">Cargando reserva…</p>
      )}
      {reservation.isError && (
        <div className="cancel-panel">
          <ErrorMessage error={reservation.error} />
        </div>
      )}
      {reservation.isSuccess && (
        <Cancellation
          reservation={reservation.data}
          onStale={() => void reservation.refetch()}
        />
      )}
    </section>
  );
}

function Cancellation({
  reservation,
  onStale,
}: {
  reservation: ReservationToCancel;
  onStale: () => void;
}) {
  const queryClient = useQueryClient();
  const [acknowledged, setAcknowledged] = useState(false);
  const [reason, setReason] = useState('');
  const { reservationRef } = reservation;

  const cancellation = useMutation({
    mutationFn: () =>
      cancelReservation(reservationRef, {
        updatedAt: reservation.updatedAt,
        acknowledged: true,
        ...(reason.trim() === '' ? {} : { reason: reason.trim() }),
      }),
    onSuccess: () =>
      // El listado, el detalle y el resumen del día cambiaron.
      queryClient.invalidateQueries({ queryKey: ['reservations'] }),
    onError: () => {
      // Si otra persona la cambió, se vuelve a leer: trae su estado y su `updatedAt` de ahora.
      onStale();
    },
  });

  if (cancellation.isSuccess) {
    return <Done result={cancellation.data} />;
  }

  const blocked = blockedMessage(reservation);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (acknowledged && !cancellation.isPending) {
      cancellation.mutate();
    }
  };

  return (
    <>
      <div className="cancel-panel">
        <h2>Reserva a cancelar</h2>
        <dl className="cancel-fields">
          <Field label="Referencia">{reservationRef}</Field>
          <Field label="Huésped">
            {reservation.guest.firstName} {reservation.guest.lastName}
          </Field>
          <Field label="Fechas (in → out)">
            {formatDate(reservation.startDate)} →{' '}
            {formatDate(reservation.endDate)}
          </Field>
          <Field label="Noches">{reservation.nights}</Field>
          <Field label="Personas">{reservation.guestCount}</Field>
          <Field label="Habitaciones">
            {reservation.rooms
              .map(
                (room) =>
                  `${room.roomNumber ?? 'Sin asignar'} · ${room.categoryRoom}`,
              )
              .join(', ')}
          </Field>
        </dl>
      </div>

      {blocked !== null ? (
        <div className="cancel-panel">
          {/* Si la cancelación falló porque otra persona la cambió, su mensaje sigue a la vista. */}
          {cancellation.isError && <ErrorMessage error={cancellation.error} />}
          <p role="alert" className="error-message">
            {blocked}
          </p>
        </div>
      ) : (
        <form className="cancel-panel" onSubmit={submit} noValidate>
          <h2>Confirmación</h2>
          <label className="cancel-label" htmlFor="cancel-reason">
            Motivo (opcional)
          </label>
          <textarea
            id="cancel-reason"
            value={reason}
            maxLength={MAX_REASON_LENGTH}
            rows={3}
            placeholder="Ej. el huésped canceló su viaje"
            onChange={(event) => setReason(event.target.value)}
          />
          <label className="cancel-check">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            Entiendo que la cancelación no se puede deshacer.
          </label>
          {cancellation.isError && <ErrorMessage error={cancellation.error} />}
          <div className="cancel-buttons">
            <button
              type="submit"
              className="cancel-confirm"
              disabled={!acknowledged || cancellation.isPending}
            >
              {cancellation.isPending ? 'Cancelando…' : 'Confirmar cancelación'}
            </button>
            <Link to={`/reservas/${reservationRef}`}>Volver sin cancelar</Link>
          </div>
        </form>
      )}
    </>
  );
}

/**
 * Por qué la reserva no se puede cancelar desde Recepción, con el mensaje del backend para ese caso, o
 * `null` si se puede: solo las directas en `ACTIVE` o `PENDING` (regla de `cancel-reservation`).
 */
function blockedMessage(reservation: ReservationToCancel): string | null {
  if (reservation.source === 'OTA') {
    return OTA_MESSAGE;
  }
  if (reservation.status !== 'ACTIVE' && reservation.status !== 'PENDING') {
    return STATUS_MESSAGE;
  }
  return null;
}

function Done({ result }: { result: CancellationResult }) {
  return (
    <div className="cancel-panel">
      <p role="status" className="cancel-done">
        La reserva {result.reservationRef} quedó cancelada.
      </p>
      <div className="cancel-buttons">
        <Link to={`/reservas/${result.reservationRef}`}>Ver el detalle</Link>
        <Link to="/reservas">Volver a reservas</Link>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="cancel-field">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** `2026-10-23` como `23/10/2026` (plan base, "Fechas"). */
function formatDate(date: string): string {
  const [year, month, day] = date.split('-');
  return `${day}/${month}/${year}`;
}
