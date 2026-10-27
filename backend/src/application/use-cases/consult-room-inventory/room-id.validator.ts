/** UUID en su forma estándar `8-4-4-4-12` (hexadecimal), de cualquier versión: el plan no fija una. */
const UUID_FORMAT =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** El `roomId` es un UUID. */
export function isValidRoomId(roomId: string): boolean {
  return UUID_FORMAT.test(roomId);
}
