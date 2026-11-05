import type { MigrationStatus, ReservationStatus } from '../shared/enums.js';

/**
 * El `migrationStatus` de una reserva para mostrarlo (plan de `check-view-reservation`, "`migrationStatus`",
 * FR-005b). Se calcula, no se guarda. `hasForeignMovement` dice si la reserva tiene movimientos migratorios
 * de huéspedes extranjeros; solo cuenta cuando la estadía empezó (`IN_PROGRESS` o `COMPLETED`).
 */
export function deriveMigrationStatus(
  status: ReservationStatus,
  hasForeignMovement: boolean,
): MigrationStatus {
  switch (status) {
    case 'ACTIVE':
    case 'PENDING':
      return 'AWAITING_CHECK_IN';
    case 'CANCELLED':
    case 'NO_SHOW':
      return 'NO_CHECK_IN';
    case 'IN_PROGRESS':
    case 'COMPLETED':
      return hasForeignMovement ? 'COMPLETE' : 'NOT_REQUIRED';
  }
}
