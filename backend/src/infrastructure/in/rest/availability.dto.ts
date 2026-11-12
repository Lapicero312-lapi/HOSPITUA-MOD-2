import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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

/*
 * Los DTO son clases, y no tipos, para que OpenAPI los describa (plan base, "Contratos REST"): los usa la
 * documentación de la vista previa de la reserva directa (T017 de `generate-direct-reservation`).
 */

/** Los días de la estadía que se cruzan con un mantenimiento. */
export class MaintenanceOverlapDto {
  @ApiProperty({ format: 'date', example: '2026-10-13' })
  overlapStart: string;

  @ApiProperty({ format: 'date', example: '2026-10-14' })
  overlapEnd: string;
}

/** Una habitación en el DTO compartido `availability`. */
export class AvailabilityRoomDto {
  @ApiProperty({ format: 'uuid' })
  roomId: string;

  @ApiProperty({ example: '201' })
  roomNumber: string;

  @ApiProperty()
  available: boolean;

  /** `null` si está disponible. */
  @ApiProperty({
    type: String,
    enum: ['RESERVED', 'MAINTENANCE'],
    nullable: true,
    description: '`null` si está disponible.',
  })
  reason: UnavailabilityReason | null;

  /** El de `UNAVAILABILITY_MESSAGES`; `null` si está disponible. */
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'El mensaje que ve la Recepcionista; `null` si está disponible.',
    example: null,
  })
  message: string | null;

  /** Solo con `MAINTENANCE`: los días de la estadía que se cruzan con cada mantenimiento. */
  @ApiPropertyOptional({
    type: [MaintenanceOverlapDto],
    description:
      'Solo con `MAINTENANCE`: los días de la estadía que se cruzan con cada mantenimiento.',
  })
  maintenance?: MaintenanceOverlapDto[];
}

/** El DTO compartido `availability` que incluyen las vistas previas de los flujos (plan, B). */
export class AvailabilityDto {
  @ApiProperty({ format: 'date', example: '2026-10-12' })
  startDate: string;

  @ApiProperty({ format: 'date', example: '2026-10-15' })
  endDate: string;

  /** La categoría consultada; `null` si se verificó una habitación por `roomId`. */
  @ApiProperty({ type: String, nullable: true, example: 'DOBLE' })
  categoryRoom: string | null;

  @ApiProperty({ example: 3 })
  availableCount: number;

  @ApiProperty({ type: [AvailabilityRoomDto] })
  rooms: AvailabilityRoomDto[];
}

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
