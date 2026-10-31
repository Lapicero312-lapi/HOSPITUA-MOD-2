import type { Reservation } from '../../../../domain/reservation/reservation.js';
import type {
  ReservationStatus,
  StatusReason,
  StayStatus,
} from '../../../../domain/shared/enums.js';
import type { Transaction } from '../../../ports/out/transaction.js';

export interface ReservationStatusPort {
  transition(
    tx: Transaction,
    reservation: Reservation,
    target: ReservationStatus,
    reason: StatusReason,
  ): Promise<Reservation>;
  transitionStay(
    tx: Transaction,
    reservation: Reservation,
    roomId: string,
    target: StayStatus,
  ): Promise<Reservation>;
}
