import { assignRooms } from '../../../domain/reservation/assign-rooms.js';
import { BusinessError } from '../../../domain/shared/business-error.js';
import {
  GUEST_COUNT_EXCEEDS_CAPACITY,
  INVALID_ROOM_ID,
  ROOM_NOT_AVAILABLE,
} from '../../../domain/shared/error-codes.js';
import type { AvailabilityResult } from '../check-room-availability/ports/in/verify-availability.port.js';
import type { RequestedRoom } from './direct-reservation-request.validator.js';
import { NO_AVAILABILITY } from './error-codes.js';
import type { AssignedRoom } from './ports/in/preview-direct-reservation.port.js';

/**
 * Asigna una habitación a cada entrada de la solicitud y revisa su capacidad (plan, punto 11, pasos 3 y
 * 4). La usan la vista previa y la creación con el resultado de `VerifyAvailability.check` de la
 * categoría. El primero que falla da el error:
 * 1. por posición, una entrada con `roomId` que no está en el resultado (no existe o es de otra
 *    categoría) da `INVALID_ROOM_ID`, y una que no está disponible, `ROOM_NOT_AVAILABLE` con su número;
 * 2. las entradas sin `roomId` reciben, en su orden, las disponibles de menor `roomNumber`, sin repetir
 *    las elegidas; si no alcanzan, `NO_AVAILABILITY`;
 * 3. por posición, un `guestCount` mayor que el `maxCapacity` da `GUEST_COUNT_EXCEEDS_CAPACITY`.
 * @returns Una habitación por entrada, en el orden de la solicitud.
 */
export function assignDirectRooms(
  requested: readonly RequestedRoom[],
  availability: AvailabilityResult,
): AssignedRoom[] {
  // Un `roomId` es un UUID: se compara sin distinguir mayúsculas, como en el validador.
  const byId = new Map(
    availability.rooms.map((entry) => [entry.room.id.toLowerCase(), entry]),
  );
  const chosen = requested.map(({ roomId }) => {
    if (roomId === null) {
      return null;
    }
    const entry = byId.get(roomId.toLowerCase());
    if (entry === undefined) {
      throw new BusinessError(INVALID_ROOM_ID.code, INVALID_ROOM_ID.message);
    }
    if (!entry.available) {
      throw new BusinessError(
        ROOM_NOT_AVAILABLE.code,
        ROOM_NOT_AVAILABLE.message(entry.room.roomNumber),
      );
    }
    return entry.room;
  });

  const pending = chosen.filter((room) => room === null).length;
  const automatic = assignRooms(
    availability,
    pending,
    chosen.flatMap((room) => (room === null ? [] : [room.id])),
  );
  if (automatic.length < pending) {
    throw new BusinessError(NO_AVAILABILITY.code, NO_AVAILABILITY.message);
  }

  let next = 0;
  const assigned = requested.map(({ guestCount }, index): AssignedRoom => {
    const room = chosen[index] ?? automatic[next++];
    return { position: index + 1, room, guestCount };
  });
  if (assigned.some(({ room, guestCount }) => guestCount > room.maxCapacity)) {
    throw new BusinessError(
      GUEST_COUNT_EXCEEDS_CAPACITY.code,
      GUEST_COUNT_EXCEEDS_CAPACITY.message,
    );
  }
  return assigned;
}
