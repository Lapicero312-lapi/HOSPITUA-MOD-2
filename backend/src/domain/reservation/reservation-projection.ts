import type { DocumentType, ReservationStatus } from '../shared/enums.js';
import type { Reservation } from './reservation.js';

/**
 * El detalle de una reserva para el Módulo 1 (spec de `check-view-reservation`, FR-014), con la forma del
 * mensaje acordado con ese equipo: la lista del día y sus actualizaciones `ADDED` y `UPDATED` lo llevan, y
 * comparar la proyección de antes y de después dice si "cambió un campo de FR-014". Nunca lleva importes,
 * comisión ni tarifas (FR-015).
 */
export type ReservationProjection = {
  reservationRef: string;
  status: ReservationStatus;
  /** `DIRECTA`, o el nombre de la agencia en mayúsculas y sin el dominio (`Booking.com` → `BOOKING`). */
  source: string;
  /** Solo en reservas `OTA`. */
  externalConfirmationCode?: string;
  startDate: string;
  endDate: string;
  guestCount: number;
  notes: string | null;
  /** ISO 8601 con zona horaria y microsegundos (es el control de concurrencia). */
  updatedAt: string;
  rooms: {
    roomId: string;
    roomNumber: string;
    categoryRoom: string;
    guestCount: number;
  }[];
  guest: {
    guestRef: string;
    firstName: string;
    lastName: string;
    fullName: string;
    documentType: DocumentType | null;
    documentNumber: string | null;
    nationality: string | null;
    contactPhone: string | null;
    contactEmail: string | null;
  };
};

/**
 * La proyección de una reserva guardada y con todas sus habitaciones asignadas: las que tienen una sin
 * asignar no viajan al Módulo 1 (FR-014), y eso lo decide quien llama. `otaName` es el nombre de su
 * agencia, que la reserva no guarda; en una reserva directa no se usa.
 */
export function projectReservation(
  reservation: Reservation,
  otaName: string | null,
): ReservationProjection {
  if (reservation.updatedAt === null) {
    throw new Error('Una reserva que no se ha guardado no se puede proyectar.');
  }
  const ota = reservation.ota;
  if (reservation.source === 'OTA' && (ota === null || otaName === null)) {
    throw new Error('Una reserva de OTA se proyecta con su agencia.');
  }
  const guest = reservation.guest;
  return {
    reservationRef: reservation.reservationRef,
    status: reservation.status,
    source:
      reservation.source === 'DIRECT' ? 'DIRECTA' : agencySource(otaName ?? ''),
    ...(reservation.source === 'OTA' && ota !== null
      ? { externalConfirmationCode: ota.externalConfirmationCode }
      : {}),
    startDate: reservation.startDate,
    endDate: reservation.endDate,
    guestCount: reservation.guestCount,
    notes: reservation.notes,
    updatedAt: isoTimestamp(reservation.updatedAt),
    rooms: reservation.rooms.map((room) => {
      if (room.roomId === null || room.roomNumber === null) {
        throw new Error(
          'Una reserva con una habitación sin asignar no se proyecta.',
        );
      }
      return {
        roomId: room.roomId,
        roomNumber: room.roomNumber,
        categoryRoom: room.categoryRoom,
        guestCount: room.guestCount,
      };
    }),
    guest: {
      guestRef: guest.id,
      firstName: guest.firstName,
      lastName: guest.lastName,
      fullName: guest.fullName,
      documentType: guest.documentType,
      documentNumber: guest.documentNumber,
      nationality: guest.nationality,
      contactPhone: guest.contactPhone,
      contactEmail: guest.contactEmail,
    },
  };
}

/** El nombre de la agencia en mayúsculas y sin el dominio: `Booking.com` → `BOOKING`. */
function agencySource(otaName: string): string {
  return otaName.split('.')[0].toUpperCase();
}

/**
 * El `updatedAt` como lo escribe PostgreSQL (`2026-10-08 20:42:10.12+00`: con espacio, sin los ceros
 * finales de los microsegundos y la zona sin minutos) en ISO 8601, con sus seis dígitos de microsegundos
 * y la zona completa: `2026-10-08T20:42:10.120000+00:00`. Es la misma hora: solo cambia cómo se escribe.
 * Se hace sobre el texto porque `Date` solo guarda milisegundos.
 */
function isoTimestamp(updatedAt: string): string {
  const match =
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(?:(Z)|([+-]\d{2})(?::?(\d{2}))?)$/.exec(
      updatedAt,
    );
  if (match === null) {
    throw new Error('El updatedAt de la reserva no tiene un formato conocido.');
  }
  const [, date, time, fraction = '', utc, offsetHours, offsetMinutes = '00'] =
    match;
  const zone = utc === 'Z' ? '+00:00' : `${offsetHours}:${offsetMinutes}`;
  return `${date}T${time}.${fraction.padEnd(6, '0')}${zone}`;
}
