import type { Reservation } from '../../../../../domain/reservation/reservation.js';
import type {
  ReservationStatus,
  StatusReason,
  StayStatus,
} from '../../../../../domain/shared/enums.js';
import type { Transaction } from '../../../../ports/out/transaction.js';

/** Símbolo con el que Nest inyecta el servicio en los demás casos de uso. */
export const RESERVATION_STATUS = Symbol('RESERVATION_STATUS');

/**
 * El único lugar donde cambia el estado de una reserva y de sus habitaciones (plan base, regla 1). Lo usan
 * `update-reservation` (Check-In, Check-Out, cierre del día y cambios de Booking) y `cancel-reservation`,
 * dentro de su transacción. Crear una reserva no pasa por aquí: su estado inicial lo ponen las fábricas.
 */
export interface ReservationStatusPort {
  /**
   * Cambia el `status` y guarda la reserva con el control de concurrencia optimista. Con `NO_SHOW` pasa
   * también a `NOT_ARRIVED` sus habitaciones en `EXPECTED` (FR-019).
   * @throws BusinessError `INVALID_STATUS_TRANSITION` o `CONCURRENT_UPDATE`.
   */
  transition(
    tx: Transaction,
    reservation: Reservation,
    target: ReservationStatus,
    reason: StatusReason,
  ): Promise<Reservation>;

  /**
   * Cambia el `stayStatus` de la habitación `roomId` y guarda la reserva; con eso se recalcula si la
   * habitación ocupa inventario (D3).
   * @throws BusinessError `INVALID_STATUS_TRANSITION` o `CONCURRENT_UPDATE`.
   */
  transitionStay(
    tx: Transaction,
    reservation: Reservation,
    roomId: string,
    target: StayStatus,
  ): Promise<Reservation>;
}
