import { projectReservation } from './reservation-projection.js';
import type { Reservation } from './reservation.js';

/** Los motivos de un `REMOVED` (plan base, columna `daily_list_message.removal_reason`). */
export type RemovalReason =
  'CANCELLED' | 'DATE_CHANGED' | 'NO_SHOW' | 'ROOM_UNASSIGNED';

/** La actualización que un cambio de la reserva genera en la lista del día, si genera alguna. */
export type DailyListChange =
  | { updateType: 'ADDED' }
  | { updateType: 'UPDATED' }
  | { updateType: 'REMOVED'; removalReason: RemovalReason };

/**
 * El nombre con el que se proyectan las reservas de OTA para compararlas: la agencia de una reserva no
 * cambia, así que su nombre no decide si "cambió un campo de FR-014". El mensaje lo arma quien publica,
 * con el nombre real.
 */
const ANY_AGENCY_NAME = 'agencia';

/**
 * Cuándo una reserva entra, cambia o sale de la lista del día (plan de `check-view-reservation`, "Cuándo
 * una reserva entra, cambia o sale de la lista"). La usa `DailyListChangeRecorder` dentro de la
 * transacción del cambio, con la reserva de antes y la de después.
 */
export const DailyListMembership = {
  /**
   * Si la reserva pertenece a la lista de `operationalDate` (`AAAA-MM-DD`): llega ese día, está `ACTIVE`
   * y no tiene ninguna habitación sin asignar (D13).
   */
  belongs(reservation: Reservation, operationalDate: string): boolean {
    return (
      reservation.startDate === operationalDate &&
      reservation.status === 'ACTIVE' &&
      reservation.rooms.every((room) => room.roomId !== null)
    );
  },

  /**
   * La actualización que genera el cambio de `before` a `after` en la lista de `operationalDate`, o `null`
   * si no genera ninguna. `before` es `null` cuando la reserva se acaba de crear.
   * @throws Error si una reserva de la lista sale de ella sin un motivo de la tabla: es un error del
   * programa (por ejemplo, una transición que el dominio no admite).
   */
  evaluate(
    before: Reservation | null,
    after: Reservation,
    operationalDate: string,
  ): DailyListChange | null {
    const wasIn =
      before !== null && DailyListMembership.belongs(before, operationalDate);
    const isIn = DailyListMembership.belongs(after, operationalDate);
    if (!wasIn) {
      return isIn ? { updateType: 'ADDED' } : null;
    }
    if (isIn) {
      return changedFr014(before, after) ? { updateType: 'UPDATED' } : null;
    }
    return removalOf(after, operationalDate);
  },
};

/**
 * Por qué sale de la lista una reserva que pertenecía. El `status` decide primero: el Check-In y el
 * Check-Out los ejecuta el Módulo 1, así que no generan nada (FR-017).
 */
function removalOf(
  after: Reservation,
  operationalDate: string,
): DailyListChange | null {
  switch (after.status) {
    case 'CANCELLED':
      return { updateType: 'REMOVED', removalReason: 'CANCELLED' };
    case 'NO_SHOW':
      return { updateType: 'REMOVED', removalReason: 'NO_SHOW' };
    case 'IN_PROGRESS':
    case 'COMPLETED':
      return null;
    default:
      break;
  }
  if (after.startDate !== operationalDate) {
    return { updateType: 'REMOVED', removalReason: 'DATE_CHANGED' };
  }
  if (after.rooms.some((room) => room.roomId === null)) {
    return { updateType: 'REMOVED', removalReason: 'ROOM_UNASSIGNED' };
  }
  throw new Error(
    `La reserva ${after.reservationRef} salió de la lista del día sin un motivo de la tabla.`,
  );
}

/**
 * Si cambió algún campo de FR-014: se comparan las proyecciones de antes y de después, la misma forma que
 * viaja en el mensaje, para no enviar actualizaciones vacías. Las dos salen de `projectReservation`, que
 * arma los campos siempre en el mismo orden, así que se pueden comparar como texto.
 */
function changedFr014(before: Reservation, after: Reservation): boolean {
  return (
    JSON.stringify(projectForComparison(before)) !==
    JSON.stringify(projectForComparison(after))
  );
}

function projectForComparison(reservation: Reservation) {
  return projectReservation(
    reservation,
    reservation.source === 'OTA' ? ANY_AGENCY_NAME : null,
  );
}
