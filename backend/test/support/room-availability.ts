import { randomUUID } from 'node:crypto';

/**
 * Habitaciones para las pruebas de la verificación de disponibilidad (`check-room-availability`), con
 * los datos del ejemplo del plan. Cada función acepta cambios puntuales.
 */

/** Una habitación del inventario del Módulo 1, de la categoría DOBLE del ejemplo del plan. */
export function aRoom(
  changes: Partial<{
    id: string;
    roomNumber: string;
    categoryRoom: string;
  }> = {},
): { id: string; roomNumber: string; categoryRoom: string } {
  return {
    id: randomUUID(),
    roomNumber: '201',
    categoryRoom: 'DOBLE',
    ...changes,
  };
}

/** Una habitación en el resultado de la verificación: disponible si no trae motivo. */
export function aRoomAvailability<TRoom>(
  room: TRoom,
  reason: 'RESERVED' | 'MAINTENANCE' | null = null,
): {
  room: TRoom;
  available: boolean;
  reason: 'RESERVED' | 'MAINTENANCE' | null;
} {
  return { room, available: reason === null, reason };
}
