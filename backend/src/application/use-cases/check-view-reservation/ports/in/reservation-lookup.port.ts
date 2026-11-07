import type { Reservation } from '../../../../../domain/reservation/reservation.js';
import type { BlockingRoom } from '../../../../ports/out/reservation-query.port.js';
import type { Transaction } from '../../../../ports/out/transaction.js';

export type { BlockingRoom };

/** Símbolo con el que Nest inyecta el servicio (plan base, regla 4). */
export const RESERVATION_LOOKUP = Symbol('RESERVATION_LOOKUP');

/**
 * Cómo buscan reservas los demás casos de uso (`check-view-reservation`, "Servicio interno (FR-007)"): por
 * este puerto, nunca por la ruta REST ni por las clases de este caso de uso (regla 6). Cada tarea agrega el
 * método que le toca (`findByRef`, `findByCode`, `findForUpdate` y `blockingRoomsByCategory`).
 */
export interface ReservationLookup {
  /**
   * Las habitaciones de `roomIds` que ya ocupan inventario en `[startDate, endDate)`: una salida y una
   * llegada el mismo día no chocan. Sin las de la reserva `excludeReservationRef`, para una modificación
   * (`check-room-availability`, A1 y FR-003). Con `roomIds` vacío, `[]`.
   */
  findBlockingRooms(
    roomIds: string[],
    startDate: string,
    endDate: string,
    excludeReservationRef?: string,
  ): Promise<BlockingRoom[]>;

  /**
   * La reserva completa con esa `reservationRef` (con su `updatedAt` y su comisión), o `null` si no existe
   * (plan, "Servicio interno (FR-007)"). La usa `check-room-availability` para saber si existe la reserva
   * que se modifica (punto 7).
   */
  findByRef(reservationRef: string): Promise<Reservation | null>;

  /**
   * La reserva completa con esa `reservationRef`, como `findByRef`, bloqueada (`SELECT … FOR UPDATE`) hasta
   * que termine `tx`, o `null` si no existe (plan, "`ReservationLookup.findForUpdate`"). La usan
   * `cancel-reservation` (T005) y `update-reservation` para serializar dos cambios de la misma reserva.
   */
  findForUpdate(
    tx: Transaction,
    reservationRef: string,
  ): Promise<Reservation | null>;
}
