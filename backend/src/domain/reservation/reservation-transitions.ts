import { BusinessError } from '../shared/business-error.js';
import type { ReservationStatus, StayStatus } from '../shared/enums.js';

/**
 * Estado inicial de una reserva nueva, directa o de Booking (los specs de creación): no es una
 * transición, porque la reserva todavía no existe. Lo usan las fábricas `createDirect` y `createOta`.
 */
export const INITIAL_RESERVATION_STATUS: ReservationStatus = 'ACTIVE';
export const INITIAL_STAY_STATUS: StayStatus = 'EXPECTED';

/**
 * Transiciones de `Reservation.status` (FR-006 de `update-reservation` y la cancelación de
 * `cancel-reservation`). Cualquier otra se rechaza.
 */
const RESERVATION_TRANSITIONS: Record<
  ReservationStatus,
  readonly ReservationStatus[]
> = {
  PENDING: ['ACTIVE', 'NO_SHOW', 'CANCELLED'],
  ACTIVE: ['IN_PROGRESS', 'NO_SHOW', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

/** Transiciones de `ReservationRoom.stayStatus` (FR-007). Cualquier otra se rechaza. */
const STAY_TRANSITIONS: Record<StayStatus, readonly StayStatus[]> = {
  EXPECTED: ['CHECKED_IN', 'NOT_ARRIVED'],
  CHECKED_IN: ['CHECKED_OUT'],
  CHECKED_OUT: [],
  NOT_ARRIVED: [],
};

export function canChangeStatus(
  from: ReservationStatus,
  to: ReservationStatus,
): boolean {
  return RESERVATION_TRANSITIONS[from].includes(to);
}

export function canChangeStayStatus(from: StayStatus, to: StayStatus): boolean {
  return STAY_TRANSITIONS[from].includes(to);
}

/** El error de toda transición que no está permitida (plan de `update-reservation`). */
export function invalidStatusTransition(): BusinessError {
  return new BusinessError(
    'INVALID_STATUS_TRANSITION',
    'La transición de estado no está permitida.',
  );
}
