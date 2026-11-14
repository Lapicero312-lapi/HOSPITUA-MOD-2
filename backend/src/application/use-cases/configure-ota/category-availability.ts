import type { NightAvailability } from '../../../domain/ota/channex-grouping.js';
import { BusinessError } from '../../../domain/shared/business-error.js';
import {
  INVENTORY_UNAVAILABLE,
  MAINTENANCE_CHECK_UNAVAILABLE,
} from '../../../domain/shared/error-codes.js';
import { mapWithLimit } from '../../shared/map-with-limit.js';
import type { ReservationLookup } from '../check-view-reservation/ports/in/reservation-lookup.port.js';
import type { ConsultMaintenanceCalendar } from '../consult-maintenance-calendar/ports/in/consult-maintenance-calendar.port.js';
import type { ConsultRoomInventory } from '../consult-room-inventory/ports/in/consult-room-inventory.port.js';

/** Lo que consulta el cálculo: el inventario y los mantenimientos del Módulo 1 y las ocupadas del Módulo 2. */
export type CategoryAvailabilitySources = {
  inventory: ConsultRoomInventory;
  lookup: ReservationLookup;
  maintenance: ConsultMaintenanceCalendar;
  /** El tope de consultas de mantenimientos en paralelo (`MAINTENANCE_CONCURRENCY`). */
  concurrency: number;
};

/** Los códigos con los que el Módulo 1 "no responde" (regla 3): esa categoría no se envía. */
const MODULE1_UNAVAILABLE: readonly string[] = [
  INVENTORY_UNAVAILABLE.code,
  MAINTENANCE_CHECK_UNAVAILABLE.code,
];

/** Si `error` es que el Módulo 1 no respondió (`INVENTORY_UNAVAILABLE` o `MAINTENANCE_CHECK_UNAVAILABLE`). */
export function isModule1Unavailable(error: unknown): error is BusinessError {
  return (
    error instanceof BusinessError &&
    MODULE1_UNAVAILABLE.includes(error.errorCode)
  );
}

/**
 * La disponibilidad de cada noche de `nights` (en orden) de una categoría (plan de `configure-ota`, regla 2;
 * B3 paso 4 y B4 paso 3): las vendibles menos las distintas que están ocupadas o en mantenimiento, con el
 * `countOfRooms` del tipo como tope (regla 8). Las ocupadas y los mantenimientos se consultan una vez, de la
 * primera a la última noche; solo cuentan las habitaciones vendibles, así que el resultado no baja de 0.
 */
export async function categoryAvailability(
  sources: CategoryAvailabilitySources,
  categoryRoom: string,
  nights: string[],
  countOfRooms: number,
): Promise<NightAvailability[]> {
  const { inventory, lookup, maintenance, concurrency } = sources;
  const rooms = await inventory.byCategory(categoryRoom);
  const sellable = new Set(rooms.map(({ id }) => id));
  const first = nights[0];
  const afterLast = nextDay(nights[nights.length - 1]);

  const busy = new Map<string, Set<string>>();
  const mark = (date: string, roomId: string) => {
    if (sellable.has(roomId)) {
      busy.set(date, (busy.get(date) ?? new Set()).add(roomId));
    }
  };
  for (const { date, roomIds } of await lookup.blockingRoomsByCategory(
    categoryRoom,
    first,
    afterLast,
  )) {
    roomIds.forEach((roomId) => mark(date, roomId));
  }
  const checks = await mapWithLimit(rooms, concurrency, (room) =>
    maintenance.check(room.id, first, afterLast),
  );
  for (const { roomId, conflicts } of checks) {
    for (const { overlapStart, overlapEnd } of conflicts) {
      for (let day = overlapStart; day <= overlapEnd; day = nextDay(day)) {
        mark(day, roomId);
      }
    }
  }

  return nights.map((date) => ({
    date,
    availability: Math.min(
      rooms.length - (busy.get(date)?.size ?? 0),
      countOfRooms,
    ),
  }));
}

/** El día siguiente a una `AAAA-MM-DD`. */
export function nextDay(date: string): string {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 1);
  return day.toISOString().slice(0, 10);
}
