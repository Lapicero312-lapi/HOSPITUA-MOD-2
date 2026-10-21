export interface RoomForCategoryGrouping {
  categoryRoom: string;
  maxCapacity: number;
}

export interface RoomTypeGroup {
  categoryRoom: string;
  countOfRooms: number;
  occupancy: number;
}

export function groupRoomsByCategory(
  rooms: readonly RoomForCategoryGrouping[],
): RoomTypeGroup[] {
  const groups = new Map<string, RoomTypeGroup>();

  for (const room of rooms) {
    if (!Number.isSafeInteger(room.maxCapacity) || room.maxCapacity < 1) {
      throw new Error(
        `La capacidad máxima de la categoría ${room.categoryRoom} no es válida.`,
      );
    }

    const group = groups.get(room.categoryRoom);
    if (group) {
      group.countOfRooms += 1;
      group.occupancy = Math.max(group.occupancy, room.maxCapacity);
    } else {
      groups.set(room.categoryRoom, {
        categoryRoom: room.categoryRoom,
        countOfRooms: 1,
        occupancy: room.maxCapacity,
      });
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
