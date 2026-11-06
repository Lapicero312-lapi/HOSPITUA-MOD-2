/** Símbolo con el que Nest inyecta el puerto (plan base, regla 4). */
export const RESERVATION_QUERY_PORT = Symbol('RESERVATION_QUERY_PORT');

/** Una habitación que ya ocupa inventario y la reserva que la ocupa (`check-room-availability`, A1). */
export type BlockingRoom = { roomId: string; reservationRef: string };

/**
 * Las consultas de solo lectura sobre las reservas (`check-view-reservation`, `ReservationQueryPort`).
 * Cada tarea agrega el método que le toca; la T005 de ese plan agrega los filtros y la paginación.
 */
export interface ReservationQueryPort {
  /**
   * Las habitaciones de `roomIds` que ya ocupan inventario en `[startDate, endDate)`, sin las de la
   * reserva `excludeReservationRef` (`check-room-availability`, A1). Una habitación bloquea si su reserva
   * está en `PENDING`, `ACTIVE` o `IN_PROGRESS` y ella en `EXPECTED` o `CHECKED_IN`: en la base es
   * `reservation_room.blocks_inventory` (D3).
   */
  findBlockingRooms(
    roomIds: string[],
    startDate: string,
    endDate: string,
    excludeReservationRef?: string,
  ): Promise<BlockingRoom[]>;
}
