import type { ReservationDetail } from '../../../application/use-cases/check-view-reservation/ports/in/get-reservation-detail.port.js';
import {
  colombiaTime,
  colombiaTimeWithMicroseconds,
} from '../../../application/use-cases/check-view-reservation/message-time.js';

/** El dinero como texto decimal con dos decimales y su moneda (plan base, "Dinero"). */
type MoneyBody = { amount: string; currency: string };

/** El cuerpo de C3 (plan de `check-view-reservation`), tal como lo recibe la pantalla. */
export type ReservationDetailBody = {
  reservationRef: string;
  status: string;
  source: string;
  externalConfirmationCode: string | null;
  otaName: string | null;
  startDate: string;
  endDate: string;
  nights: number;
  guestCount: number;
  notes: string | null;
  createdAt: string | null;
  /** La versión de la reserva: lo que la pantalla envía al cancelar y al modificar. */
  updatedAt: string | null;
  conflict: { reason: string; detectedAt: Date } | null;
  rooms: {
    roomId: string | null;
    roomNumber: string | null;
    categoryRoom: string;
    guestCount: number;
    roomGrossAmount: MoneyBody | null;
    stayStatus: string;
  }[];
  guest: {
    firstName: string;
    lastName: string;
    documentType: string | null;
    documentNumber: string | null;
    nationality: string | null;
    contactPhone: string | null;
    contactEmail: string | null;
  };
  cancellation: {
    cancellationDate: string;
    channel: string;
    reason: string | null;
    processedBy: string;
  } | null;
};

/**
 * El cuerpo de C3 a partir de `GetReservationDetail` (plan, "`GetReservationDetail`"), sin reglas de
 * negocio: el dinero va como texto con dos decimales, `createdAt` y `cancellationDate` en hora de Colombia
 * con segundos, una habitación sin asignar con `roomId` y `roomNumber` en `null`, y `notes` tal cual.
 * `conflict` tiene la misma forma que en C1.
 */
export function toReservationDetailBody({
  reservation,
  nights,
  otaName,
  cancellation,
}: ReservationDetail): ReservationDetailBody {
  const { guest, conflict, createdAt, updatedAt } = reservation;
  return {
    reservationRef: reservation.reservationRef,
    status: reservation.status,
    source: reservation.source,
    externalConfirmationCode: reservation.ota?.externalConfirmationCode ?? null,
    otaName,
    startDate: reservation.startDate,
    endDate: reservation.endDate,
    nights,
    guestCount: reservation.guestCount,
    notes: reservation.notes,
    createdAt: createdAt === null ? null : colombiaTime(createdAt),
    // Con sus microsegundos: es el control de concurrencia de cancelar y modificar.
    updatedAt:
      updatedAt === null ? null : colombiaTimeWithMicroseconds(updatedAt),
    conflict:
      conflict === null
        ? null
        : { reason: conflict.reason, detectedAt: conflict.detectedAt },
    rooms: reservation.rooms.map((room) => ({
      roomId: room.roomId,
      roomNumber: room.roomNumber,
      categoryRoom: room.categoryRoom,
      guestCount: room.guestCount,
      roomGrossAmount:
        room.rate === null ? null : moneyBody(room.rate.roomGrossAmount),
      stayStatus: room.stayStatus,
    })),
    guest: {
      firstName: guest.firstName,
      lastName: guest.lastName,
      documentType: guest.documentType,
      documentNumber: guest.documentNumber,
      nationality: guest.nationality,
      contactPhone: guest.contactPhone,
      contactEmail: guest.contactEmail,
    },
    cancellation:
      cancellation === null
        ? null
        : {
            cancellationDate: colombiaTime(cancellation.cancellationDate),
            channel: cancellation.channel,
            reason: cancellation.reason,
            processedBy: cancellation.processedBy,
          },
  };
}

/** El importe de una habitación (`Money`): solo lo que hace falta para el cuerpo. */
function moneyBody(money: {
  amountWithCents: string;
  currency: string;
}): MoneyBody {
  return { amount: money.amountWithCents, currency: money.currency };
}
