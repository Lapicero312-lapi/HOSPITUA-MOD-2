import { Inject, Injectable } from '@nestjs/common';
import type { Reservation } from '../../../domain/reservation/reservation.js';
import type {
  ReservationStatus,
  StatusReason,
  StayStatus,
} from '../../../domain/shared/enums.js';
import {
  RESERVATION_REPOSITORY,
  type ReservationRepository,
} from '../../ports/out/reservation.repository.js';
import type { Transaction } from '../../ports/out/transaction.js';
import type { ReservationStatusPort } from './ports/in/reservation-status.port.js';

/**
 * Aplica la tabla de transiciones del dominio y guarda el cambio en la transacción de quien llama, con el
 * control de concurrencia optimista del repositorio (plan base, regla 1).
 */
@Injectable()
export class ReservationStatusService implements ReservationStatusPort {
  constructor(
    @Inject(RESERVATION_REPOSITORY)
    private readonly reservations: ReservationRepository,
  ) {}

  async transition(
    tx: Transaction,
    reservation: Reservation,
    target: ReservationStatus,
    reason: StatusReason,
  ): Promise<Reservation> {
    return this.reservations.update(reservation.withStatus(target, reason), tx);
  }

  async transitionStay(
    tx: Transaction,
    reservation: Reservation,
    roomId: string,
    target: StayStatus,
  ): Promise<Reservation> {
    return this.reservations.update(
      reservation.withStayStatus(roomId, target),
      tx,
    );
  }
}
