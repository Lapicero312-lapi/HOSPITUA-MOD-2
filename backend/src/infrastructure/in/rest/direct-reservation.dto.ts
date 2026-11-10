import type { DirectReservationPreview } from '../../../application/use-cases/generate-direct-reservation/ports/in/preview-direct-reservation.port.js';
import { type AvailabilityDto, toAvailabilityDto } from './availability.dto.js';
import { type QuotesDto, toQuotesDto } from './quotes.dto.js';

/** Una habitación asignada en la respuesta de la vista previa (plan de `generate-direct-reservation`, A). */
export type AssignedRoomDto = {
  position: number;
  roomId: string;
  roomNumber: string;
  maxCapacity: number;
  guestCount: number;
};

/** La respuesta de `POST /api/reservations/direct/preview` (plan, A). */
export type DirectReservationPreviewBody = {
  availability: AvailabilityDto;
  assignedRooms: AssignedRoomDto[];
  /** Con el `total`, que no se guarda. El `quoteId` no sale hacia la pantalla. */
  quotes: QuotesDto;
  reservation: { guestCount: number };
};

/** Convierte la vista previa en el JSON de A, con los DTO compartidos `availability` y `quotes`. */
export function toDirectReservationPreviewBody(
  preview: DirectReservationPreview,
): DirectReservationPreviewBody {
  return {
    availability: toAvailabilityDto(preview.availability, preview.categoryRoom),
    assignedRooms: preview.assignedRooms.map(
      ({ position, room, guestCount }): AssignedRoomDto => ({
        position,
        roomId: room.id,
        roomNumber: room.roomNumber,
        maxCapacity: room.maxCapacity,
        guestCount,
      }),
    ),
    quotes: toQuotesDto(preview.quotes, preview.quoteRequests, true),
    reservation: { guestCount: preview.guestCount },
  };
}
