/** Compara los `roomNumber` como números: "201" va antes que "1001" (como `assignRooms`). */
const ROOM_NUMBER_ORDER = new Intl.Collator('en', { numeric: true });

/** Lo que `diffRooms` necesita de una habitación actual de la reserva. */
type CurrentRoom = {
  roomId: string | null;
  roomNumber: string | null;
  categoryRoom: string;
};

/** Lo que `diffRooms` necesita de una habitación pedida: su `roomId` y la categoría que da el Módulo 1. */
type RequestedRoom = { roomId: string; categoryRoom: string };

/** Una habitación actual que sale y la pedida que ocupa su lugar. */
export type RoomSwap<TCurrent, TRequested> = {
  removed: TCurrent;
  added: TRequested;
};

/**
 * Qué cambia en las habitaciones de una reserva (plan de `update-reservation`, regla 2 y punto 11). Cada
 * lista trae las mismas habitaciones que recibió `diffRooms`, con todos sus campos.
 */
export type RoomsDiff<TCurrent, TRequested> = {
  /** El mismo `roomId`: solo puede cambiar su `guestCount`. En el orden de la solicitud. */
  kept: { current: TCurrent; requested: TRequested }[];
  /** La nueva hereda la tarifa de la quitada, sin recotizar, si las fechas no cambian. */
  swappedSameCategory: RoomSwap<TCurrent, TRequested>[];
  /** La nueva se cotiza. */
  swappedCategory: RoomSwap<TCurrent, TRequested>[];
  /** Se cotizan. En el orden de la solicitud. */
  added: TRequested[];
  /** Se van con su tarifa. Por `roomNumber` ascendente. */
  removed: TCurrent[];
};

/**
 * Compara las habitaciones actuales de la reserva con la lista completa de las pedidas (plan de
 * `update-reservation`, punto 11), en este orden:
 * 1. conservadas: el mismo `roomId` en las dos listas;
 * 2. cambiadas de la misma categoría: cada quitada, por `roomNumber` ascendente, con la primera agregada de
 *    su categoría en el orden de la solicitud;
 * 3. cambiadas de categoría: las quitadas y las agregadas que sobran, entre sí y en el mismo orden;
 * 4. lo que todavía sobra: agregadas y quitadas.
 *
 * Es una función pura: no valida (que no haya repetidas, de 1 a 10 habitaciones) ni sabe de tarifas;
 * eso lo hacen el validador del cambio y `roomsNeedingQuote`.
 * @throws Error si la lista pedida repite un `roomId`: el validador del cambio la rechaza antes.
 */
export function diffRooms<
  TCurrent extends CurrentRoom,
  TRequested extends RequestedRoom,
>(
  current: readonly TCurrent[],
  requested: readonly TRequested[],
): RoomsDiff<TCurrent, TRequested> {
  const requestedIds = requested.map((room) => room.roomId);
  if (new Set(requestedIds).size !== requestedIds.length) {
    throw new Error('diffRooms recibió una habitación pedida repetida.');
  }

  const kept: RoomsDiff<TCurrent, TRequested>['kept'] = [];
  const added: TRequested[] = [];
  for (const room of requested) {
    // Una actual sin asignar (`roomId` vacío) nunca coincide: el pedido siempre trae su `roomId`.
    const same = current.find((candidate) => candidate.roomId === room.roomId);
    if (same === undefined) {
      added.push(room);
    } else {
      kept.push({ current: same, requested: room });
    }
  }
  const keptRooms = new Set<TCurrent>(kept.map(({ current: room }) => room));
  const removed = current
    .filter((room) => !keptRooms.has(room))
    .sort(byRoomNumber);

  const swappedSameCategory: RoomSwap<TCurrent, TRequested>[] = [];
  const leftRemoved: TCurrent[] = [];
  for (const room of removed) {
    const index = added.findIndex(
      (candidate) => candidate.categoryRoom === room.categoryRoom,
    );
    const [match] = index === -1 ? [] : added.splice(index, 1);
    if (match === undefined) {
      leftRemoved.push(room);
    } else {
      swappedSameCategory.push({ removed: room, added: match });
    }
  }

  const pairs = Math.min(leftRemoved.length, added.length);
  const swappedCategory = leftRemoved
    .slice(0, pairs)
    .map((room, i) => ({ removed: room, added: added[i] as TRequested }));

  return {
    kept,
    swappedSameCategory,
    swappedCategory,
    added: added.slice(pairs),
    removed: leftRemoved.slice(pairs),
  };
}

/** Por `roomNumber` ascendente (orden numérico); una sin número, al final. */
function byRoomNumber(a: CurrentRoom, b: CurrentRoom): number {
  if (a.roomNumber === null || b.roomNumber === null) {
    return Number(a.roomNumber === null) - Number(b.roomNumber === null);
  }
  return ROOM_NUMBER_ORDER.compare(a.roomNumber, b.roomNumber);
}
