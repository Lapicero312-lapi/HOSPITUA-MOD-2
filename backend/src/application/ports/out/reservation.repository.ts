import type { Reservation } from '../../../domain/reservation/reservation.js';
import type { Transaction } from './transaction.js';

/** Símbolo con el que Nest inyecta el repositorio (plan base, regla 4). */
export const RESERVATION_REPOSITORY = Symbol('RESERVATION_REPOSITORY');

/**
 * Guarda y lee el agregado `Reservation` completo (la reserva, sus habitaciones y su titular). Sin
 * `tx`, cada método usa su propia transacción.
 */
export interface ReservationRepository {
  findById(id: string, tx?: Transaction): Promise<Reservation | null>;

  findByRef(
    reservationRef: string,
    tx?: Transaction,
  ): Promise<Reservation | null>;

  /**
   * Si ya hay una reserva de la agencia con ese código de confirmación (FR-005 de
   * `register-ota-information-commission`). La restricción única `(ota_id, external_confirmation_code)`
   * sigue siendo el respaldo.
   */
  existsOtaConfirmationCode(
    otaId: string,
    externalConfirmationCode: string,
    tx?: Transaction,
  ): Promise<boolean>;

  /**
   * Lee la reserva y la bloquea (`SELECT … FOR UPDATE`) hasta que termine la transacción, para
   * serializar dos cambios de la misma reserva.
   */
  lockByRef(
    reservationRef: string,
    tx: Transaction,
  ): Promise<Reservation | null>;

  /**
   * Guarda una reserva nueva y la devuelve con su `createdAt` y su `updatedAt`.
   * @throws RoomOverlapError, DuplicateReservationRefError o DuplicateConfirmationCodeError.
   */
  insert(reservation: Reservation, tx?: Transaction): Promise<Reservation>;

  /**
   * Guarda los cambios de una reserva si nadie la cambió desde que se leyó: si su `updatedAt` ya no es
   * el vigente, lanza `CONCURRENT_UPDATE`. Agrega, cambia y quita habitaciones según
   * la lista nueva. Devuelve la reserva con su `updatedAt` nuevo.
   * @throws BusinessError `CONCURRENT_UPDATE` o RoomOverlapError.
   */
  update(reservation: Reservation, tx?: Transaction): Promise<Reservation>;
}

/**
 * La restricción anti-solape (D3) rechazó una habitación: otra reserva la ocupa en esas fechas. Cada
 * flujo lo traduce a su error de disponibilidad (`AVAILABILITY_TAKEN`, `ROOM_NOT_AVAILABLE`, ...).
 */
export class RoomOverlapError extends Error {
  constructor() {
    super('Otra reserva ocupa la habitación en esas fechas (D3).');
  }
}

/** Ya existe una reserva con esa referencia: quien la crea genera otra. */
export class DuplicateReservationRefError extends Error {
  constructor(readonly reservationRef: string) {
    super(`Ya existe una reserva con la referencia ${reservationRef}.`);
  }
}

/** Ya existe una reserva de esa agencia con ese código de confirmación. */
export class DuplicateConfirmationCodeError extends Error {
  constructor() {
    super(
      'Ya existe una reserva de esa agencia con ese código de confirmación.',
    );
  }
}
