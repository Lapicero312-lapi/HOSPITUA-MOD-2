import { randomUUID } from 'node:crypto';

/**
 * Habitaciones para las pruebas de la verificación de disponibilidad (`check-room-availability`), con
 * los datos del ejemplo del plan. `aRoom` y `aRoomAvailability` aceptan cambios puntuales;
 * `theAvailabilityExample` arma el ejemplo completo.
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

/** Una habitación en el resultado de la verificación (`RoomAvailability` del plan); por defecto, disponible. */
export function aRoomAvailability<TRoom>(
  room: TRoom,
  changes: Partial<{
    available: boolean;
    reason: 'RESERVED' | 'MAINTENANCE' | null;
    maintenance: { overlapStart: string; overlapEnd: string }[];
  }> = {},
): {
  room: TRoom;
  available: boolean;
  reason: 'RESERVED' | 'MAINTENANCE' | null;
  maintenance: { overlapStart: string; overlapEnd: string }[];
} {
  return { room, available: true, reason: null, maintenance: [], ...changes };
}

/**
 * El resultado del ejemplo del plan (DTO `availability`): categoría DOBLE del 2026-10-10 al 2026-10-12,
 * con la 201 disponible, la 202 reservada y la 203 en mantenimiento del 2026-10-11 al 2026-10-12.
 */
export function theAvailabilityExample() {
  const room201 = aRoom({ roomNumber: '201' });
  const room202 = aRoom({ roomNumber: '202' });
  const room203 = aRoom({ roomNumber: '203' });
  return {
    room201,
    room202,
    room203,
    result: {
      startDate: '2026-10-10',
      endDate: '2026-10-12',
      rooms: [
        aRoomAvailability(room201),
        aRoomAvailability(room202, { available: false, reason: 'RESERVED' }),
        aRoomAvailability(room203, {
          available: false,
          reason: 'MAINTENANCE',
          maintenance: [
            { overlapStart: '2026-10-11', overlapEnd: '2026-10-12' },
          ],
        }),
      ],
    },
  };
}
