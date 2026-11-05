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
  /**
   * La versión de la reserva, tal como la entrega el repositorio: para el dominio es opaca (plan base).
   * Pasarla a ISO 8601 con zona horaria y microsegundos es de quien publica el mensaje.
   */
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
    updatedAt: reservation.updatedAt,
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
