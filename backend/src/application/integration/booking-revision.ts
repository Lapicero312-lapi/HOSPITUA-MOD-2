import type { Money } from '../../domain/shared/money.js';

export type BookingRevisionStatus = 'new' | 'modified' | 'cancelled';

/** Una habitación de la revisión. `roomTypeId` vacío: la habitación de Booking no está mapeada en Channex. */
export type BookingRevisionRoom = {
  roomTypeId: string | null;
  ratePlanId: string | null;
  checkinDate: string;
  checkoutDate: string;
  adults: number;
  children: number;
  infants: number;
};

/** El titular tal como lo envía Booking; cualquier dato puede faltar. */
export type BookingRevisionCustomer = {
  name: string | null;
  surname: string | null;
  mail: string | null;
  phone: string | null;
  /** Código de país (`CO`); `generate-ota-reservation` lo convierte al nombre. */
  country: string | null;
};

/**
 * Una revisión de reserva del feed de Channex, con los campos que usa `generate-ota-reservation` (tabla
 * de B de su plan). De ella se crea o cambia la `Reservation`; solo su `id` se guarda, en
 * `OtaBookingRevision`. Es un objeto de integración (plan base, "Datos externos").
 */
export type BookingRevision = {
  id: string;
  /** El mismo para todas las revisiones de una reserva. */
  bookingId: string;
  otaReservationCode: string | null;
  otaName: string | null;
  status: BookingRevisionStatus;
  arrivalDate: string;
  departureDate: string;
  /** Valor bruto que envía la agencia, en su moneda; `null` si no viene. */
  amount: Money | null;
  notes: string | null;
  customer: BookingRevisionCustomer;
  rooms: BookingRevisionRoom[];
};
