import type { Reservation } from '../../../domain/reservation/reservation.js';
import type { Transaction } from './transaction.js';

export const RESERVATION_REPOSITORY = Symbol('RESERVATION_REPOSITORY');

export interface ReservationRepository {
  findById(id: string, tx?: Transaction): Promise<Reservation | null>;
  findByRef(
    reservationRef: string,
    tx?: Transaction,
  ): Promise<Reservation | null>;
  lockByRef(
    reservationRef: string,
    tx: Transaction,
  ): Promise<Reservation | null>;
  insert(reservation: Reservation, tx?: Transaction): Promise<Reservation>;
  update(reservation: Reservation, tx?: Transaction): Promise<Reservation>;
}

/** La restricción anti-solape (D3) rechazo una habitación ocupada. */
export class RoomOverlapError extends Error {
  constructor() {
    super('Otra reserva ocupa la habitación en esas fechas (D3).');
  }
}

export class DuplicateReservationRefError extends Error {
  constructor(readonly reservationRef: string) {
    super(`Ya existe una reserva con la referencia ${reservationRef}.`);
  }
}

export class DuplicateConfirmationCodeError extends Error {
  constructor() {
    super(
      'Ya existe una reserva de esa agencia con ese código de confirmación.',
    );
  }
}
