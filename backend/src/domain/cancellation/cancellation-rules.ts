import { canChangeStatus } from '../reservation/reservation-transitions.js';
import type {
  CancellationChannel,
  ReservationSource,
  ReservationStatus,
} from '../shared/enums.js';

/**
 * El canal por el que se cancela cada reserva (plan de `cancel-reservation`, regla 1; spec, FR-002a): la
 * Recepcionista, solo las `DIRECT` (`RECEPTION`); Booking, solo las suyas (`OTA_API`).
 */
const CHANNEL_BY_SOURCE: Record<ReservationSource, CancellationChannel> = {
  DIRECT: 'RECEPTION',
  OTA: 'OTA_API',
};

/** Si una reserva de ese `source` se puede cancelar por `channel`. */
export function canCancelThroughChannel(
  source: ReservationSource,
  channel: CancellationChannel,
): boolean {
  return CHANNEL_BY_SOURCE[source] === channel;
}

/**
 * Si el estado de la reserva admite cancelación (regla 2; spec, FR-002: solo `ACTIVE` o `PENDING`). Usa
 * las transiciones de `status`, que solo permiten pasar a `CANCELLED` desde esos dos.
 */
export function isCancellable(status: ReservationStatus): boolean {
  return canChangeStatus(status, 'CANCELLED');
}
