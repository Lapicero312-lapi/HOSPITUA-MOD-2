import type { BlockingRoom } from '../../../../ports/out/reservation-query.port.js';

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
}
