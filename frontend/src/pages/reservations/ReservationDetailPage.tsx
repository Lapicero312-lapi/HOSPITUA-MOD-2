import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { ErrorMessage } from '../../components/ErrorMessage.tsx';
import {
  getReservationDetail,
  type DetailCancellation,
  type DetailGuest,
  type DetailRoom,
  type DetailStatus,
  type Money,
  type ReservationDetail,
  type StayStatus,
} from '../../services/reservation-detail.ts';
import './ReservationDetailPage.css';

const STATUS_LABELS: Record<DetailStatus, string> = {
  ACTIVE: 'Activa',
  PENDING: 'Pendiente',
  IN_PROGRESS: 'En curso',
  COMPLETED: 'Completada',
  CANCELLED: 'Cancelada',
  NO_SHOW: 'No se presentó',
};

const STAY_STATUS_LABELS: Record<StayStatus, string> = {
  EXPECTED: 'Esperada',
  CHECKED_IN: 'Con Check-In',
  CHECKED_OUT: 'Con Check-Out',
  NOT_ARRIVED: 'No llegó',
};

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  RC: 'Registro Civil',
  TI: 'Tarjeta de Identidad',
  CC: 'Cédula de ciudadanía',
  CE: 'Cédula de extranjería',
  PAS: 'Pasaporte',
  NIT: 'NIT',
};

const CONFLICT_LABELS: Record<string, string> = {
  NO_ROOM_AVAILABLE: 'No hay habitación disponible',
  CAPACITY_EXCEEDED: 'Las personas superan la capacidad',
  CHANGE_NOT_APPLICABLE: 'El cambio de Booking no se pudo aplicar',
};

const CANCELLATION_CHANNEL_LABELS: Record<
  DetailCancellation['channel'],
  string
> = {
  RECEPTION: 'Recepción',
  OTA_API: 'Booking',
};

/** Lo que se muestra cuando un dato no viene: nunca una celda vacía. */
const EMPTY = '—';

/**
 * Pantalla "Detalle de la reserva" (spec de `check-view-reservation`, FR-006; plan, C3): los datos de la
 * reserva, sus habitaciones con su tarifa, el titular y, si está cancelada, su cancelación. Es de solo
 * lectura; desde aquí se va a modificar o a cancelar.
 */
export function ReservationDetailPage() {
  const { reservationRef = '' } = useParams();
  const detail = useQuery({
    queryKey: ['reservations', 'detail', reservationRef],
    queryFn: ({ signal }) => getReservationDetail(reservationRef, signal),
  });

  return (
    <section className="detail">
      <Link className="detail-back" to="/reservas">
        ← Volver a reservas
      </Link>
      {detail.isPending && (
        <p className="detail-state detail-state--loading">Cargando reserva…</p>
      )}
      {detail.isError && (
        <div className="detail-panel">
          <ErrorMessage error={detail.error} />
        </div>
      )}
      {detail.isSuccess && <Detail reservation={detail.data} />}
    </section>
  );
}

function Detail({ reservation }: { reservation: ReservationDetail }) {
  const { reservationRef } = reservation;
  // FR-005: Modificar y Cancelar solo en reservas directas ACTIVE o PENDING.
  const editable =
    reservation.source === 'DIRECT' &&
    (reservation.status === 'ACTIVE' || reservation.status === 'PENDING');
  // FR-005 y FR-025: una reserva en conflicto con una habitación sin asignar se puede ubicar.
  const assignable =
    reservation.conflict !== null &&
    reservation.rooms.some((room) => room.roomId === null);

  return (
    <>
      <header className="detail-header">
        <h1 className="detail-title">Reserva {reservationRef}</h1>
        <span
          className={`detail-status detail-status--${reservation.status.toLowerCase()}`}
        >
          {STATUS_LABELS[reservation.status]}
        </span>
        <span className="detail-actions">
          {editable && (
            <>
              <Link to={`/reservas/${reservationRef}/modificar`}>
                Modificar
              </Link>
              <Link
                className="detail-action--danger"
                to={`/reservas/${reservationRef}/cancelar`}
              >
                Cancelar reserva
              </Link>
            </>
          )}
          {assignable && (
            <Link to={`/reservas/${reservationRef}/asignar-habitacion`}>
              Asignar habitación
            </Link>
          )}
        </span>
      </header>

      {reservation.conflict !== null && (
        <p className="detail-conflict" role="status">
          <strong>En conflicto:</strong>{' '}
          {CONFLICT_LABELS[reservation.conflict.reason] ??
            reservation.conflict.reason}
          , desde el {formatDateTime(reservation.conflict.detectedAt)}.
        </p>
      )}

      <div className="detail-panel">
        <h2>Estadía y tarifa</h2>
        <dl className="detail-fields">
          <Field label="Canal">
            {reservation.source === 'DIRECT'
              ? 'Directo'
              : `OTA · ${reservation.otaName ?? EMPTY}`}
          </Field>
          {reservation.source === 'OTA' && (
            <Field label="Código de la OTA">
              {reservation.externalConfirmationCode ?? EMPTY}
            </Field>
          )}
          <Field label="Fecha de entrada">
            {formatDate(reservation.startDate)}
          </Field>
          <Field label="Fecha de salida">
            {formatDate(reservation.endDate)}
          </Field>
          <Field label="Noches">{reservation.nights}</Field>
          <Field label="Personas">{reservation.guestCount}</Field>
          <Field label="Creada el">
            {reservation.createdAt === null
              ? EMPTY
              : formatDateTime(reservation.createdAt)}
          </Field>
          <Field label="Observaciones">
            {reservation.notes === null || reservation.notes === ''
              ? EMPTY
              : reservation.notes}
          </Field>
        </dl>
        <RoomsTable rooms={reservation.rooms} />
      </div>

      <div className="detail-panel">
        <h2>Datos del huésped</h2>
        <GuestFields guest={reservation.guest} />
      </div>

      {reservation.cancellation !== null && (
        <div className="detail-panel">
          <h2>Cancelación</h2>
          <dl className="detail-fields">
            <Field label="Fecha">
              {formatDateTime(reservation.cancellation.cancellationDate)}
            </Field>
            <Field label="Canal">
              {CANCELLATION_CHANNEL_LABELS[reservation.cancellation.channel] ??
                reservation.cancellation.channel}
            </Field>
            <Field label="Motivo">
              {reservation.cancellation.reason ?? EMPTY}
            </Field>
            <Field label="Procesada por">
              {reservation.cancellation.processedBy}
            </Field>
          </dl>
        </div>
      )}
    </>
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
    <div className="detail-field">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function RoomsTable({ rooms }: { rooms: DetailRoom[] }) {
  const total = totalOf(rooms);
  return (
    <table className="detail-table">
      <thead>
        <tr>
          <th scope="col">Habitación</th>
          <th scope="col">Categoría</th>
          <th scope="col">Personas</th>
          <th scope="col">Valor bruto</th>
          <th scope="col">Estado en la reserva</th>
        </tr>
      </thead>
      <tbody>
        {rooms.map((room, index) => (
          // Varias habitaciones pueden estar sin asignar: no hay otra clave estable.
          <tr key={room.roomId ?? index}>
            <td>{room.roomNumber ?? 'Sin asignar'}</td>
            <td>{room.categoryRoom}</td>
            <td>{room.guestCount}</td>
            <td className="detail-money">
              {room.roomGrossAmount === null
                ? EMPTY
                : formatMoney(room.roomGrossAmount)}
            </td>
            <td>{STAY_STATUS_LABELS[room.stayStatus] ?? room.stayStatus}</td>
          </tr>
        ))}
      </tbody>
      {total !== null && (
        <tfoot>
          <tr>
            <th scope="row" colSpan={3}>
              Total
            </th>
            <td className="detail-money">{formatMoney(total)}</td>
            <td />
          </tr>
        </tfoot>
      )}
    </table>
  );
}

function GuestFields({ guest }: { guest: DetailGuest }) {
  return (
    <dl className="detail-fields">
      <Field label="Nombre completo">
        {guest.firstName} {guest.lastName}
      </Field>
      <Field label="Tipo de documento">
        {guest.documentType === null
          ? EMPTY
          : (DOCUMENT_TYPE_LABELS[guest.documentType] ?? guest.documentType)}
      </Field>
      <Field label="Documento">{guest.documentNumber ?? EMPTY}</Field>
      <Field label="Nacionalidad">{guest.nationality ?? EMPTY}</Field>
      <Field label="Teléfono">{guest.contactPhone ?? EMPTY}</Field>
      <Field label="Email">{guest.contactEmail ?? EMPTY}</Field>
    </dl>
  );
}

/**
 * El total de la reserva: la suma de las tarifas de sus habitaciones. No viene del backend porque no se
 * guarda: se calcula al mostrarlo (plan de `calculate-dynamic-rate`, FR-002). Se suma en centavos con
 * enteros, sin pasar por decimales de coma flotante. `null` si alguna habitación no tiene tarifa (reservas
 * `OTA`) o si las monedas no coinciden.
 */
function totalOf(rooms: DetailRoom[]): Money | null {
  const amounts = rooms.map((room) => room.roomGrossAmount);
  const [first] = amounts;
  if (
    first === undefined ||
    first === null ||
    amounts.some(
      (amount) => amount === null || amount.currency !== first.currency,
    )
  ) {
    return null;
  }
  let cents = 0n;
  for (const amount of amounts as Money[]) {
    const [whole, decimals = ''] = amount.amount.split('.');
    cents += BigInt(whole) * 100n + BigInt(decimals.padEnd(2, '0').slice(0, 2));
  }
  const text = cents.toString().padStart(3, '0');
  return {
    amount: `${text.slice(0, -2)}.${text.slice(-2)}`,
    currency: first.currency,
  };
}

/** `713000.00 COP` como `713.000,00 COP`: puntos de miles y coma decimal, sin pasar por un número. */
function formatMoney(money: Money): string {
  const [whole, decimals = '00'] = money.amount.split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${decimals} ${money.currency}`;
}

/** `2026-10-23` como `23/10/2026` (plan base, "Fechas"). */
function formatDate(date: string): string {
  const [year, month, day] = date.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

/** La diferencia de la hora de Colombia con UTC: no tiene horario de verano. */
const COLOMBIA_OFFSET_HOURS = -5;

/**
 * Una fecha con hora como `09/10/2026 10:15`, en hora de Colombia. Sirve con cualquier desfase en el
 * texto (`-05:00` o `Z`) y no depende de la zona horaria del computador.
 */
function formatDateTime(dateTime: string): string {
  const instant = new Date(dateTime);
  if (Number.isNaN(instant.getTime())) {
    return dateTime;
  }
  const colombia = new Date(
    instant.getTime() + COLOMBIA_OFFSET_HOURS * 60 * 60 * 1000,
  ).toISOString();
  return `${formatDate(colombia)} ${colombia.slice(11, 16)}`;
}
