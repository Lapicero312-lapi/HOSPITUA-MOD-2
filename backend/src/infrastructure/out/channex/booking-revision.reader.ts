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
 * trae un `status`, una fecha, un importe o una habitación inválidos, no se puede leer: se omite y,
 * como no se confirma, sigue en el feed (plan base, "`ChannexPort`").
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
  const amount = readAmount(attributes.amount, attributes.currency);
  if (amount === undefined) {
    return unreadable('importe o moneda inválidos');
  }
  if (!Array.isArray(attributes.rooms)) {
    return unreadable('sin rooms');
  }
  const rooms = attributes.rooms.map(readRoom);
  if (rooms.some((room) => room === null)) {
    return unreadable('una habitación inválida');
  }

  return {
    id,
    bookingId: attributes.booking_id,
    otaReservationCode: optionalText(attributes.ota_reservation_code),
    otaName: optionalText(attributes.ota_name),
    status: attributes.status as BookingRevisionStatus,
    arrivalDate: attributes.arrival_date,
    departureDate: attributes.departure_date,
    amount,
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

/** `null` si no viene; `undefined` si viene con otra forma. */
function readAmount(
  amount: unknown,
  currency: unknown,
): Money | null | undefined {
  if (amount === undefined || amount === null) {
    return null;
  }
  if (
    typeof amount !== 'string' ||
    !AMOUNT_FORMAT.test(amount) ||
    typeof currency !== 'string' ||
    !CURRENCY_FORMAT.test(currency)
  ) {
    return undefined;
  }
  return Money.of(amount, currency);
}

function readRoom(value: unknown): BookingRevisionRoom | null {
  if (
    !isObject(value) ||
    !isRealDate(value.checkin_date) ||
    !isRealDate(value.checkout_date) ||
    !isObject(value.occupancy)
  ) {
    return null;
  }
  const { adults, children = 0, infants = 0 } = value.occupancy;
  if (![adults, children, infants].every(isCount)) {
    return null;
  }
  return {
    roomTypeId: optionalText(value.room_type_id),
    ratePlanId: optionalText(value.rate_plan_id),
    checkinDate: value.checkin_date,
    checkoutDate: value.checkout_date,
    adults: adults as number,
    children: children as number,
    infants: infants as number,
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

function isCount(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/** El texto si viene y no está vacío; si no, `null`. */
function optionalText(value: unknown): string | null {
  return isNonEmptyString(value) ? value : null;
}
