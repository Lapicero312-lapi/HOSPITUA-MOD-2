import { isUUID } from 'class-validator';

/** El `roomId` es un UUID, de cualquier versión: el plan no fija una. */
export function isValidRoomId(roomId: string): boolean {
  return isUUID(roomId);
}
