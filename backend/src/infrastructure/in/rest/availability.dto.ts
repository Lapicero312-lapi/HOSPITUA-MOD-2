import type {
  AvailabilityResult,
  UnavailabilityReason,
} from '../../../application/use-cases/check-room-availability/ports/in/verify-availability.port.js';

/**
 * Los mensajes que ve la Recepcionista por cada motivo (plan de `check-room-availability`, "Motivos que
 * se muestran a la Recepcionista", FR-002a).
 */
export const UNAVAILABILITY_MESSAGES: Readonly<
  Record<UnavailabilityReason, string>
> = {
  RESERVED: 'La habitación ya está reservada en esas fechas.',
  MAINTENANCE:
    'La habitación estará inhabilitada por mantenimiento en esas fechas.',
};

/** Una habitación en el DTO compartido `availability`. */
export type AvailabilityRoomDto = {
  roomId: string;
  roomNumber: string;
  available: boolean;
  /** `null` si está disponible. */
  reason: UnavailabilityReason | null;
  /** El de `UNAVAILABILITY_MESSAGES`; `null` si está disponible. */
  message: string | null;
  /** Solo con `MAINTENANCE`: los días de la estadía que se cruzan con cada mantenimiento. */
  maintenance?: { overlapStart: string; overlapEnd: string }[];
};

/** El DTO compartido `availability` que incluyen las vistas previas de los flujos (plan, B). */
export type AvailabilityDto = {
  startDate: string;
  endDate: string;
  /** La categoría consultada; `null` si se verificó una habitación por `roomId`. */
  categoryRoom: string | null;
  availableCount: number;
  rooms: AvailabilityRoomDto[];
};

/**
 * Convierte el resultado de `VerifyAvailability` en el DTO compartido `availability` (plan, B y punto 9).
 * No lleva la `reservationRef` que bloquea ni datos del huésped: el resultado no los trae, y de cada
 * habitación solo salen sus campos del DTO.
 */
export function toAvailabilityDto(
  result: AvailabilityResult,
  categoryRoom: string | null,
): AvailabilityDto {
  return {
    startDate: result.startDate,
    endDate: result.endDate,
    categoryRoom,
    availableCount: result.rooms.filter(({ available }) => available).length,
    rooms: result.rooms.map(
      ({ room, available, reason, maintenance }): AvailabilityRoomDto => ({
        roomId: room.id,
        roomNumber: room.roomNumber,
        available,
        reason,
        message: reason === null ? null : UNAVAILABILITY_MESSAGES[reason],
        ...(reason === 'MAINTENANCE'
          ? {
              maintenance: maintenance.map(({ overlapStart, overlapEnd }) => ({
                overlapStart,
                overlapEnd,
              })),
            }
          : {}),
      }),
    ),
  };
}
