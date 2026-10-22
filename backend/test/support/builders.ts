import { randomBytes, randomUUID } from 'node:crypto';
import { Guest, type GuestProps } from '../../src/domain/guest/guest.js';
import { Ota, type OtaProps } from '../../src/domain/ota/ota.js';
import {
  Reservation,
  type OtaTerms,
  type ReservationProps,
} from '../../src/domain/reservation/reservation.js';
import {
  ReservationRoom,
  type ReservationRoomProps,
} from '../../src/domain/reservation/reservation-room.js';
import { Money } from '../../src/domain/shared/money.js';

/** Datos válidos para las pruebas; cada función acepta cambios puntuales. */

export function aReservationRef(): string {
  return `RSV-${randomBytes(4).toString('hex').toUpperCase()}`;
}

export function aGuest(changes: Partial<GuestProps> = {}): Guest {
  return Guest.restore({
    id: randomUUID(),
    firstName: 'Valentina',
    lastName: 'Ospina',
    documentType: 'CC',
    documentNumber: '1144093552',
    nationality: 'Colombia',
    contactPhone: '+57 300 000 0000',
    contactEmail: 'valentina@correo.com',
    ...changes,
  });
}

/** Una habitación de reserva directa: asignada y con su tarifa. */
export function aDirectRoom(
  changes: Partial<ReservationRoomProps> = {},
): ReservationRoom {
  return ReservationRoom.restore({
    id: randomUUID(),
    roomId: randomUUID(),
    roomNumber: '201',
    categoryRoom: 'DOBLE',
    guestCount: 2,
    rate: {
      roomGrossAmount: Money.of('530000', 'COP'),
      quoteId: `Q-${randomUUID()}`,
    },
    stayStatus: 'EXPECTED',
    ...changes,
  });
}

/** Una habitación de Booking: sin tarifa. */
export function anOtaRoom(
  changes: Partial<ReservationRoomProps> = {},
): ReservationRoom {
  return aDirectRoom({ rate: null, ...changes });
}

export function aDirectReservation(
  changes: Partial<ReservationProps> = {},
): Reservation {
  return Reservation.restore({
    id: randomUUID(),
    reservationRef: aReservationRef(),
    source: 'DIRECT',
    startDate: '2026-11-10',
    endDate: '2026-11-12',
    rooms: [aDirectRoom()],
    guest: aGuest(),
    status: 'ACTIVE',
    statusReason: null,
    notes: 'Llegada tarde',
    ota: null,
    conflict: null,
    createdAt: null,
    updatedAt: null,
    ...changes,
  });
}

export function otaTerms(
  otaId: string,
  changes: Partial<OtaTerms> = {},
): OtaTerms {
  return {
    otaId,
    externalConfirmationCode: '4417829013',
    grossAmount: Money.of('400', 'USD'),
    commissionPercentage: '15',
    commissionAmount: Money.of('60', 'USD'),
    commissionStatus: 'CALCULATED',
    ...changes,
  };
}

export function anOtaReservation(
  otaId: string,
  changes: Partial<ReservationProps> = {},
): Reservation {
  return aDirectReservation({
    source: 'OTA',
    rooms: [anOtaRoom()],
    guest: aGuest({ documentType: null, documentNumber: null }),
    ota: otaTerms(otaId),
    ...changes,
  });
}

export function anOta(changes: Partial<OtaProps> = {}): Ota {
  return Ota.restore({
    id: randomUUID(),
    name: 'Booking.com',
    hotelAccountId: '10485037',
    commissionPercentage: '15',
    connectionStatus: 'CONNECTED',
    linkedAt: new Date('2026-03-02T14:14:00.000Z'),
    lastSyncAt: new Date('2026-10-09T12:58:00.000Z'),
    ...changes,
  });
}
