import { CountryNames } from '../../../domain/shared/country-names.js';
import type { Money } from '../../../domain/shared/money.js';
import type {
  BookingRevision,
  BookingRevisionRoom,
} from '../../integration/booking-revision.js';

/** Tamaños de las columnas (plan base, `reservation` y `guest`), en caracteres. */
const MAX_CONFIRMATION_CODE = 50;
const MAX_NAME = 100;
const MAX_PHONE = 30;
const MAX_EMAIL = 254;
const MAX_NOTES = 500;

/** Los caracteres de control (`\p{Cc}`), salvo el salto de línea y la tabulación (plan, punto 5). */
const INVALID_NOTES_CHARACTERS = /[^\P{Cc}\n\t]/gu;

/** El titular de la reserva, tal como lo envía Booking (plan, tabla de B). */
export type OtaGuestData = {
  firstName: string;
  lastName: string;
  /** Booking no envía el documento: queda vacío hasta el Check-In. */
  documentType: null;
  documentNumber: null;
  /** El nombre del país (`CountryNames`); vacía si el código no está en la tabla. */
  nationality: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
};

/** Una habitación de la reserva, antes de relacionarla con su categoría. */
export type OtaRoomData = {
  /**
   * El tipo de habitación en Channex; su categoría la da `ota_room_type_mapping` (`configure-ota`).
   * Vacío si la habitación de Booking no está mapeada en Channex (paso 3 de B1).
   */
  channexRoomTypeId: string | null;
  checkinDate: string;
  checkoutDate: string;
  /** Adultos más niños; los bebés no se cuentan. */
  guestCount: number;
};

/** Los datos del Módulo 2 que salen de una revisión `new` o `modified` (plan, tabla de B). */
export type OtaReservationData = {
  externalConfirmationCode: string;
  startDate: string;
  endDate: string;
  /** El valor bruto (`amount`), en la moneda de Booking. */
  grossAmount: Money | null;
  /** Solo para calcular el porcentaje de la agencia con su primera reserva: no se guarda. */
  otaCommission: Money | null;
  /** Saneada y recortada a 500 caracteres. */
  notes: string | null;
  guest: OtaGuestData;
  rooms: OtaRoomData[];
};

/** Una revisión que no se puede guardar (payload ilegible): el motivo, sin datos personales. */
export type IllegibleRevision = { reason: string };

/**
 * Convierte una revisión de Channex en los datos del Módulo 2 (plan, tabla de B y punto 5). Copia los
 * datos tal como llegan, sin completarlos ni recortarlos; solo `notes` se sanea y se recorta. Si falta un
 * dato obligatorio o uno no cabe en su columna, la revisión es ilegible: no se guarda ni se confirma.
 * No cambia la revisión que recibe.
 */
export function mapBookingRevision(
  revision: BookingRevision,
): OtaReservationData | IllegibleRevision {
  const { customer } = revision;
  const code = revision.otaReservationCode;
  if (!hasText(code)) {
    return illegible('sin ota_reservation_code');
  }
  if (length(code) > MAX_CONFIRMATION_CODE) {
    return illegible('ota_reservation_code de más de 50 caracteres');
  }
  if (!hasText(customer.name) || !hasText(customer.surname)) {
    return illegible('el titular sin nombre o sin apellido');
  }
  if (length(customer.name) > MAX_NAME || length(customer.surname) > MAX_NAME) {
    return illegible(
      'el nombre o el apellido del titular de más de 100 caracteres',
    );
  }
  if (customer.phone !== null && length(customer.phone) > MAX_PHONE) {
    return illegible('el teléfono del titular de más de 30 caracteres');
  }
  if (customer.mail !== null && length(customer.mail) > MAX_EMAIL) {
    return illegible('el correo del titular de más de 254 caracteres');
  }
  if (revision.rooms.length === 0) {
    return illegible('sin habitaciones');
  }
  const rooms = revision.rooms.map(toRoomData);
  if (rooms.some((room) => room.guestCount < 1)) {
    return illegible('una habitación sin personas');
  }

  return {
    externalConfirmationCode: code,
    startDate: revision.arrivalDate,
    endDate: revision.departureDate,
    grossAmount: revision.amount,
    otaCommission: revision.otaCommission,
    notes: sanitizeNotes(revision.notes),
    guest: {
      firstName: customer.name,
      lastName: customer.surname,
      documentType: null,
      documentNumber: null,
      nationality: CountryNames.nameOf(customer.country),
      contactPhone: customer.phone,
      contactEmail: customer.mail,
    },
    rooms,
  };
}

export function isIllegible(
  result: OtaReservationData | IllegibleRevision,
): result is IllegibleRevision {
  return 'reason' in result;
}

/**
 * Las observaciones sin caracteres de control (salvo el salto de línea y la tabulación) ni espacios
 * alrededor, recortadas a 500 caracteres; `null` si quedan vacías (plan, punto 5).
 */
function sanitizeNotes(notes: string | null): string | null {
  const clean = (notes ?? '').replace(INVALID_NOTES_CHARACTERS, '').trim();
  return clean === '' ? null : Array.from(clean).slice(0, MAX_NOTES).join('');
}

/** Adultos más niños; el que no venga cuenta como 0 y los bebés no se cuentan (plan, tabla de B). */
function toRoomData(room: BookingRevisionRoom): OtaRoomData {
  return {
    channexRoomTypeId: room.roomTypeId,
    checkinDate: room.checkinDate,
    checkoutDate: room.checkoutDate,
    guestCount: (room.adults ?? 0) + (room.children ?? 0),
  };
}

/** Si el texto viene y no es solo espacios. */
function hasText(text: string | null): text is string {
  return text !== null && text.trim() !== '';
}

/** La cantidad de caracteres, como la cuenta `varchar` (no las unidades UTF-16 de JavaScript). */
function length(text: string): number {
  return Array.from(text).length;
}

function illegible(reason: string): IllegibleRevision {
  return { reason };
}
