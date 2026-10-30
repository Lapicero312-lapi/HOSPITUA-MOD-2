import type {
  BookingRevision,
  BookingRevisionCustomer,
  BookingRevisionRoom,
  BookingRevisionStatus,
} from '../../../application/integration/booking-revision.js';
import { Money } from '../../../domain/shared/money.js';
import { isNonEmptyString, isObject, isRealDate } from '../http-call.js';

const STATUSES: readonly string[] = [
  'new',
  'modified',
  'cancelled',
] satisfies BookingRevisionStatus[];

/** Un importe con hasta dos decimales (la columna es `numeric(14,2)`), sin signo. */
const AMOUNT_FORMAT = /^\d{1,12}(\.\d{1,2})?$/;
const CURRENCY_FORMAT = /^[A-Z]{3}$/;

/** Una revisión que no se puede leer: el motivo, sin datos personales, y su `id` si lo trae. */
export type UnreadableRevision = { id: string | null; reason: string };

/**
 * Lee una revisión del feed (`generate-ota-reservation`, A1). Si le falta el `id` o el `booking_id`, o
 * trae un `status` o una fecha inválidos (de la reserva o de una habitación), no se puede leer: se omite
 * y, como no se confirma, sigue en el feed (plan base, "`ChannexPort`"). Los demás datos que falten o
 * vengan con otra forma quedan vacíos y los decide `generate-ota-reservation`.
 */
export function readBookingRevision(
  item: unknown,
): BookingRevision | UnreadableRevision {
  const attributes = isObject(item) ? item.attributes : undefined;
  if (!isObject(attributes)) {
    return { id: null, reason: 'sin attributes' };
  }
  const id = isNonEmptyString(attributes.id) ? attributes.id : null;
  if (id === null || !isNonEmptyString(attributes.booking_id)) {
    return { id, reason: 'sin id o booking_id' };
  }
  const unreadable = (reason: string): UnreadableRevision => ({ id, reason });

  if (
    typeof attributes.status !== 'string' ||
    !STATUSES.includes(attributes.status)
  ) {
    return unreadable('status inválido');
  }
  if (
    !isRealDate(attributes.arrival_date) ||
    !isRealDate(attributes.departure_date)
  ) {
    return unreadable('fecha de llegada o de salida inválida');
  }
  const rooms = Array.isArray(attributes.rooms)
    ? attributes.rooms.map(readRoom)
    : [];
  if (rooms.some((room) => room === null)) {
    return unreadable('una habitación con una fecha inválida');
  }

  return {
    id,
    bookingId: attributes.booking_id,
    otaReservationCode: optionalText(attributes.ota_reservation_code),
    otaName: optionalText(attributes.ota_name),
    status: attributes.status as BookingRevisionStatus,
    arrivalDate: attributes.arrival_date,
    departureDate: attributes.departure_date,
    amount: readAmount(attributes.amount, attributes.currency),
    otaCommission: readAmount(attributes.ota_commission, attributes.currency),
    notes: optionalText(attributes.notes),
    customer: readCustomer(attributes.customer),
    rooms: rooms as BookingRevisionRoom[],
  };
}

export function isUnreadable(
  revision: BookingRevision | UnreadableRevision,
): revision is UnreadableRevision {
  return 'reason' in revision;
}

/** El importe con su moneda; `null` si no viene o viene con otra forma (nunca se redondea). */
function readAmount(amount: unknown, currency: unknown): Money | null {
  if (
    typeof amount !== 'string' ||
    !AMOUNT_FORMAT.test(amount) ||
    typeof currency !== 'string' ||
    !CURRENCY_FORMAT.test(currency)
  ) {
    return null;
  }
  return Money.of(amount, currency);
}

/** Una habitación; `null` si no trae sus fechas de llegada y de salida válidas. */
function readRoom(value: unknown): BookingRevisionRoom | null {
  if (
    !isObject(value) ||
    !isRealDate(value.checkin_date) ||
    !isRealDate(value.checkout_date)
  ) {
    return null;
  }
  const occupancy = isObject(value.occupancy) ? value.occupancy : {};
  return {
    roomTypeId: optionalText(value.room_type_id),
    ratePlanId: optionalText(value.rate_plan_id),
    checkinDate: value.checkin_date,
    checkoutDate: value.checkout_date,
    adults: count(occupancy.adults),
    // Channex puede no enviar niños ni bebés: sin el dato, no hay.
    children: occupancy.children === undefined ? 0 : count(occupancy.children),
    infants: occupancy.infants === undefined ? 0 : count(occupancy.infants),
  };
}

function readCustomer(value: unknown): BookingRevisionCustomer {
  const customer = isObject(value) ? value : {};
  return {
    name: optionalText(customer.name),
    surname: optionalText(customer.surname),
    mail: optionalText(customer.mail),
    phone: optionalText(customer.phone),
    country: optionalText(customer.country),
  };
}

/** Una cantidad de personas; `null` si no viene o no es un entero mayor o igual a 0. */
function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

/** El texto si viene y no está vacío; si no, `null`. */
function optionalText(value: unknown): string | null {
  return isNonEmptyString(value) ? value : null;
}
