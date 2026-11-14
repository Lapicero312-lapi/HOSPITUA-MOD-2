import type { RoomsDiff } from './diff-rooms.js';

/** Las fechas de la estadía, en `AAAA-MM-DD`. */
type Stay = { startDate: string; endDate: string };

/**
 * Qué habitaciones hay que volver a cotizar al modificar una reserva (plan de `calculate-dynamic-rate`, B2
 * y T004). Las devuelve en el orden de la solicitud:
 * - si cambian `startDate` o `endDate`, todas las de `after.rooms`;
 * - si no, solo las agregadas y las nuevas de las cambiadas de categoría.
 *
 * Las conservadas mantienen su tarifa, las cambiadas de la misma categoría heredan la de la que sale y las
 * quitadas se van con la suya. Una lista vacía significa que no se llama al Módulo 3.
 * @param diff Lo que devolvió `diffRooms` con `after.rooms`: trae esas mismas habitaciones, así que se
 * reconocen por identidad.
 */
export function roomsNeedingQuote<TCurrent, TRequested>(
  before: Stay,
  after: Stay & { rooms: readonly TRequested[] },
  diff: RoomsDiff<TCurrent, TRequested>,
): TRequested[] {
  if (
    before.startDate !== after.startDate ||
    before.endDate !== after.endDate
  ) {
    return [...after.rooms];
  }
  const quoted = new Set<TRequested>([
    ...diff.added,
    ...diff.swappedCategory.map(({ added }) => added),
  ]);
  return after.rooms.filter((room) => quoted.has(room));
}
