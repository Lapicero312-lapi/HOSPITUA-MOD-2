import type { Room } from '../../../../integration/room.js';

/** Símbolo con el que Nest inyecta el servicio en los flujos de reserva (plan base, regla 4). */
export const VERIFY_AVAILABILITY = Symbol('VERIFY_AVAILABILITY');

/** Por qué una habitación no está disponible (plan, B). */
export type UnavailabilityReason = 'RESERVED' | 'MAINTENANCE';

/** Lo que se verifica: unas fechas y una categoría o una habitación (plan, B). */
export type AvailabilityQuery = {
  /** `AAAA-MM-DD`. */
  startDate: string;
  /** `AAAA-MM-DD`, posterior a `startDate`: es la salida. */
  endDate: string;
  /** Exactamente uno de los dos: la categoría o el `roomId`. */
  categoryRoom?: string;
  roomId?: string;
  /** Solo al modificar una reserva: la propia no cuenta como ocupada (FR-003). */
  excludeReservationRef?: string;
  /**
   * Opcional: detenerse al encontrar esta cantidad de disponibles (plan, punto 5). Las candidatas se
   * consultan de menor a mayor `roomNumber`; las que estaban en curso terminan, así que puede haber más
   * disponibles que `limit`. Un entero mayor que 0.
   */
  limit?: number;
};

/** Una habitación consultada y si está disponible (plan, B). */
export type RoomAvailability = {
  room: Room;
  available: boolean;
  /** `null` si está disponible. */
  reason: UnavailabilityReason | null;
  /** Solo si `reason` es `MAINTENANCE`: los días de la estadía que se cruzan con cada mantenimiento. */
  maintenance: { overlapStart: string; overlapEnd: string }[];
};

/** El resultado de la verificación (plan, B). */
export type AvailabilityResult = {
  startDate: string;
  endDate: string;
  /**
   * Todas las consultadas, ordenadas por `roomNumber` (orden numérico). Con `limit`, no trae las que no
   * se llegaron a consultar en el calendario.
   */
  rooms: RoomAvailability[];
};

/**
 * La verificación de disponibilidad que usan los flujos de reserva antes de abrir su transacción (plan,
 * B1). Una habitación no disponible no es un error: sale con su motivo. El error lo decide el flujo con
 * `requireAvailable`.
 */
export interface VerifyAvailability {
  /**
   * B1: el inventario, después el cruce con las reservas y al final los mantenimientos, en ese orden. Si
   * falla la consulta de una sola habitación, falla toda (todo o nada).
   * @throws BusinessError `INVALID_STAY_DATES`, `INVALID_AVAILABILITY_QUERY` o `RESERVATION_NOT_FOUND`
   * (sin consultar a nadie); `INVALID_CATEGORY`, `INVALID_ROOM_ID` o `INVENTORY_UNAVAILABLE` (del
   * inventario); `MAINTENANCE_CHECK_UNAVAILABLE` (del calendario).
   */
  check(query: AvailabilityQuery): Promise<AvailabilityResult>;
}
