import { deriveMigrationStatus } from '../../../domain/reservation/migration-status.js';
import type { ReservationListItem } from '../../ports/out/reservation-query.port.js';
import type { ReservationListRow } from './ports/in/list-reservations.port.js';

/**
 * La fila del listado de una reserva (plan de `check-view-reservation`, C1 y T010): una sola fila con
 * todas sus habitaciones, el `migrationStatus` (FR-005b), el conflicto de Booking (FR-002a) y las acciones
 * que admite. No lleva importes, comisión ni tarifas (FR-015).
 */
export function toReservationListRow({
  reservation,
  otaName,
  hasForeignMovement,
}: ReservationListItem): ReservationListRow {
  const editable =
    reservation.source === 'DIRECT' &&
    (reservation.status === 'ACTIVE' || reservation.status === 'PENDING');
  const conflict = reservation.conflict;
  return {
    reservationRef: reservation.reservationRef,
    externalConfirmationCode: reservation.ota?.externalConfirmationCode ?? null,
    guest: {
      fullName: reservation.guest.fullName,
      documentNumber: reservation.guest.documentNumber,
    },
    rooms: reservation.rooms.map((room) => ({
      roomNumber: room.roomNumber,
      categoryRoom: room.categoryRoom,
    })),
    source: reservation.source,
    otaName: reservation.source === 'OTA' ? otaName : null,
    startDate: reservation.startDate,
    endDate: reservation.endDate,
    status: reservation.status,
    migrationStatus: deriveMigrationStatus(
      reservation.status,
      hasForeignMovement,
    ),
    conflict:
      conflict === null
        ? null
        : { reason: conflict.reason, detectedAt: conflict.detectedAt },
    actions: {
      // FR-005: solo las directas en ACTIVE o PENDING se modifican o cancelan desde la pantalla.
      canModify: editable,
      canCancel: editable,
      // `update-reservation`, B3: una reserva de Booking en conflicto con alguna habitación sin asignar.
      canAssignRoom:
        conflict !== null &&
        reservation.rooms.some((room) => room.roomId === null),
    },
  };
}
