/** Compara los `roomNumber` como números: "201" va antes que "1001". */
const ROOM_NUMBER_ORDER = new Intl.Collator('en', { numeric: true });

/**
 * Elige las `quantity` habitaciones disponibles de menor `roomNumber` (orden numérico), sin repetir una
 * ya asignada a la misma reserva (`alreadyAssigned`, por `roomId`) (plan de `check-room-availability`,
 * B3). Si hay menos disponibles que las pedidas, devuelve las que haya.
 *
 * Recibe solo los campos que usa del `AvailabilityResult`: el dominio no conoce los tipos de
 * `application/`. Devuelve las mismas habitaciones que recibe, con todos sus campos.
 */
export function assignRooms<TRoom extends { id: string; roomNumber: string }>(
  result: { rooms: readonly { room: TRoom; available: boolean }[] },
  quantity: number,
  alreadyAssigned: readonly string[],
): TRoom[] {
  return result.rooms
    .filter(
      ({ room, available }) => available && !alreadyAssigned.includes(room.id),
    )
    .map(({ room }) => room)
    .sort((a, b) => ROOM_NUMBER_ORDER.compare(a.roomNumber, b.roomNumber))
    .slice(0, quantity);
}
