import type { Room } from '../../integration/room.js';

/** Lo que el Módulo 2 envía a Channex por categoría (plan de `configure-ota`, A2 y C1, paso 1). */
export type RoomTypeGroup = {
  categoryRoom: string;
  /** Las habitaciones vendibles de la categoría (`count_of_rooms`). */
  countOfRooms: number;
  /** La mayor `maxCapacity` de la categoría (`occ_adults` y `default_occupancy`). */
  occupancy: number;
};

/** La disponibilidad de un tipo de habitación en una noche (`AAAA-MM-DD`). */
export type NightAvailability = { date: string; availability: number };

/** Un rango de A4: `dateFrom` y `dateTo` incluidos, con el mismo valor todas las noches. */
export type AvailabilityRange = {
  dateFrom: string;
  dateTo: string;
  availability: number;
};

/**
 * C1, paso 1 (T003): agrupa por categoría las habitaciones vendibles que informa el Módulo 1, con su
 * cantidad y su mayor capacidad. Ordenadas por categoría, para que el resultado no dependa del orden en
 * que llegan.
 */
export function groupRoomsByCategory(rooms: readonly Room[]): RoomTypeGroup[] {
  const groups = new Map<string, RoomTypeGroup>();
  for (const room of rooms) {
    const group = groups.get(room.categoryRoom);
    if (group === undefined) {
      groups.set(room.categoryRoom, {
        categoryRoom: room.categoryRoom,
        countOfRooms: 1,
        occupancy: room.maxCapacity,
      });
    } else {
      group.countOfRooms += 1;
      group.occupancy = Math.max(group.occupancy, room.maxCapacity);
    }
  }
  return [...groups.values()].sort((a, b) =>
    a.categoryRoom < b.categoryRoom
      ? -1
      : a.categoryRoom > b.categoryRoom
        ? 1
        : 0,
  );
}

/**
 * A4 (T003): las noches seguidas con el mismo valor se envían juntas, como un rango con `dateFrom` y
 * `dateTo` incluidos. Una noche que falta corta el rango. El resultado va en orden de fecha, aunque las
 * noches lleguen desordenadas.
 * @throws Error si una fecha no es una `AAAA-MM-DD` real o si viene dos veces: es un error del programa.
 */
export function toChannexRanges(
  nights: readonly NightAvailability[],
): AvailabilityRange[] {
  const sorted = [...nights].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  );
  const ranges: AvailabilityRange[] = [];
  let previous: string | null = null;
  for (const { date, availability } of sorted) {
    const day = dayNumber(date);
    if (previous !== null && dayNumber(previous) === day) {
      throw new Error(`La noche ${date} viene dos veces.`);
    }
    const last = ranges.at(-1);
    if (
      last !== undefined &&
      previous !== null &&
      dayNumber(previous) + 1 === day &&
      last.availability === availability
    ) {
      last.dateTo = date;
    } else {
      ranges.push({ dateFrom: date, dateTo: date, availability });
    }
    previous = date;
  }
  return ranges;
}

const MS_PER_DAY = 86_400_000;
const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

/** Los días desde 1970-01-01 de una `AAAA-MM-DD`, sin zona horaria. */
function dayNumber(date: string): number {
  const time = Date.parse(`${date}T00:00:00Z`);
  if (
    !DATE_FORMAT.test(date) ||
    Number.isNaN(time) ||
    new Date(time).toISOString().slice(0, 10) !== date
  ) {
    throw new Error(`La fecha ${date} no es una AAAA-MM-DD real.`);
  }
  return time / MS_PER_DAY;
}
