import type { MovementType } from '../../../../../domain/shared/enums.js';
import type { Transaction } from '../../../../ports/out/transaction.js';
import type { NotifiedGuest } from '../../guest-payload.validator.js';

/** Símbolo con el que Nest inyecta el servicio en `update-reservation` (plan base, regla 4). */
export const REGISTER_GUEST_MOVEMENTS = Symbol('REGISTER_GUEST_MOVEMENTS');

/**
 * Un huésped de la lista `guests`, tal como lo deja `readGuestNotification` (plan, B1). Cualquier dato
 * puede faltar: `register` omite al huésped al que le falte uno que la base exige (regla 3) y no revisa el
 * contenido de los demás (FR-004). `originPlace` y `destinationPlace` solo son obligatorios para los
 * extranjeros, y eso lo garantiza el Módulo 1.
 */
export type GuestPayload = NotifiedGuest;

/** Una notificación de Check-In o de Check-Out ya revisada (plan, B1). */
export type RegisterGuestMovementsCommand = {
  /** La reserva ya fue localizada por quien llama. */
  reservationId: string;
  roomId: string;
  /** Vale para todos los huéspedes de la lista. */
  movementType: MovementType;
  /** `AAAA-MM-DD`; vale para todos los huéspedes de la lista. */
  movementDate: string;
  guests: GuestPayload[];
};

/** Lo que se registró de una notificación (plan, B1). `update-reservation` lo usa en su log. */
export type RegistrationSummary = {
  /** Huéspedes únicos en la lista. */
  received: number;
  /** Movimientos nuevos creados. */
  registered: number;
  /** Movimientos que ya existían (reenvío o cambio de habitación). */
  alreadyRegistered: number;
  /** Extranjeros entre los recibidos. */
  foreign: number;
  /** Omitidos por faltarles un dato que la base exige. */
  skipped: number;
};

/**
 * El registro de los huéspedes de una notificación de Check-In o de Check-Out (plan de
 * `process-guest-data`, B1 y "Reglas de registro"). Lo llama el consumidor de `update-reservation`.
 */
export interface RegisterGuestMovements {
  /**
   * Guarda los datos de cada huésped una sola vez por reserva y su movimiento de entrada o de salida, sin
   * duplicar aunque la notificación se repita. Corre dentro de la transacción del consumidor: recibe la
   * transacción abierta y no hace `commit`.
   * @throws Error si la reserva no existe: quien llama ya la localizó.
   */
  register(
    tx: Transaction,
    command: RegisterGuestMovementsCommand,
  ): Promise<RegistrationSummary>;
}
