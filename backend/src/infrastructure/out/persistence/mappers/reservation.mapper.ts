import {
  Reservation,
  type OtaTerms,
} from '../../../../domain/reservation/reservation.js';
import { ReservationRoom } from '../../../../domain/reservation/reservation-room.js';
import type {
  CommissionStatus,
  ConflictReason,
  ReservationSource,
  ReservationStatus,
  StayStatus,
} from '../../../../domain/shared/enums.js';
import { Money } from '../../../../domain/shared/money.js';
import {
  GuestTable,
  ReservationRoomTable,
  ReservationTable,
} from '../tables/reservation.tables.js';
import { decimalText } from './decimal-text.js';
import { guestToDomain, guestToTable } from './guest.mapper.js';

/** Las filas de las tres tablas del agregado. */
export type ReservationRows = {
  reservation: ReservationTable;
  rooms: ReservationRoomTable[];
  guest: GuestTable;
};

/** Arma el agregado desde la fila de `reservation` con sus habitaciones y su titular ya cargados. */
export function reservationToDomain(row: ReservationTable): Reservation {
  return Reservation.restore({
    id: row.id,
    reservationRef: row.reservationRef,
    source: row.source as ReservationSource,
    startDate: row.startDate,
    endDate: row.endDate,
    rooms: row.rooms.map(roomToDomain),
    guest: guestToDomain(row.guest),
    status: row.status as ReservationStatus,
    statusReason: row.statusReason,
    notes: row.notes,
    ota: otaTermsToDomain(row),
    conflict:
      row.conflictReason !== null && row.conflictDetectedAt !== null
        ? {
            reason: row.conflictReason as ConflictReason,
            detectedAt: row.conflictDetectedAt,
          }
        : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

/**
 * Las filas que guardan el agregado. Cada habitación lleva la copia de las fechas de su reserva y su
 * `blocks_inventory`, que la base usa para impedir el solape (D3).
 */
export function reservationToRows(reservation: Reservation): ReservationRows {
  const ota = reservation.ota;
  return {
    reservation: Object.assign(new ReservationTable(), {
      id: reservation.id,
      reservationRef: reservation.reservationRef,
      source: reservation.source,
      otaId: ota?.otaId ?? null,
      externalConfirmationCode: ota?.externalConfirmationCode ?? null,
      startDate: reservation.startDate,
      endDate: reservation.endDate,
      guestCount: reservation.guestCount,
      status: reservation.status,
      statusReason: reservation.statusReason,
      notes: reservation.notes,
      grossAmount: ota?.grossAmount.amount ?? null,
      currency: ota?.grossAmount.currency ?? null,
      commissionPercentage: reservation.commissionPercentage,
      commissionAmount: ota?.commissionAmount.amount ?? '0',
      commissionStatus: ota?.commissionStatus ?? null,
      conflictReason: reservation.conflict?.reason ?? null,
      conflictDetectedAt: reservation.conflict?.detectedAt ?? null,
    }),
    rooms: reservation.rooms.map((room) =>
      Object.assign(new ReservationRoomTable(), {
        id: room.id,
        reservationId: reservation.id,
        roomId: room.roomId,
        roomNumber: room.roomNumber,
        categoryRoom: room.categoryRoom,
        guestCount: room.guestCount,
        roomGrossAmount: room.rate?.roomGrossAmount.amount ?? null,
        quoteId: room.rate?.quoteId ?? null,
        currency: room.rate?.roomGrossAmount.currency ?? null,
        stayStatus: room.stayStatus,
        startDate: reservation.startDate,
        endDate: reservation.endDate,
        blocksInventory: room.blocksInventory(reservation.status),
      }),
    ),
    guest: guestToTable(reservation.guest, reservation.id),
  };
}

function roomToDomain(row: ReservationRoomTable): ReservationRoom {
  return ReservationRoom.restore({
    id: row.id,
    roomId: row.roomId,
    roomNumber: row.roomNumber,
    categoryRoom: row.categoryRoom,
    guestCount: row.guestCount,
    rate:
      row.roomGrossAmount !== null &&
      row.quoteId !== null &&
      row.currency !== null
        ? {
            roomGrossAmount: Money.of(row.roomGrossAmount, row.currency),
            quoteId: row.quoteId,
          }
        : null,
    stayStatus: row.stayStatus as StayStatus,
  });
}

function otaTermsToDomain(row: ReservationTable): OtaTerms | null {
  if (
    row.otaId === null ||
    row.externalConfirmationCode === null ||
    row.grossAmount === null ||
    row.currency === null ||
    row.commissionStatus === null
  ) {
    return null;
  }
  return {
    otaId: row.otaId,
    externalConfirmationCode: row.externalConfirmationCode,
    grossAmount: Money.of(row.grossAmount, row.currency),
    commissionPercentage: decimalText(row.commissionPercentage),
    commissionAmount: Money.of(row.commissionAmount, row.currency),
    commissionStatus: row.commissionStatus as CommissionStatus,
  };
}
