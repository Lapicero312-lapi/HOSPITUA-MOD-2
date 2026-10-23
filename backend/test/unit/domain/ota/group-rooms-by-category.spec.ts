import { groupRoomsByCategory } from '../../../../src/domain/ota/group-rooms-by-category.js';

describe('groupRoomsByCategory', () => {
  it('counts each category and uses its greatest room capacity', () => {
    expect(
      groupRoomsByCategory([
        { categoryRoom: 'SUITE', maxCapacity: 4 },
        { categoryRoom: 'DOBLE', maxCapacity: 2 },
        { categoryRoom: 'DOBLE', maxCapacity: 3 },
      ]),
    ).toEqual([
      { categoryRoom: 'DOBLE', countOfRooms: 2, occupancy: 3 },
      { categoryRoom: 'SUITE', countOfRooms: 1, occupancy: 4 },
    ]);
  });

  it('returns no groups for an empty inventory', () => {
    expect(groupRoomsByCategory([])).toEqual([]);
  });

  it('rejects invalid room capacity', () => {
    expect(() =>
      groupRoomsByCategory([{ categoryRoom: 'DOBLE', maxCapacity: 0 }]),
    ).toThrow('La capacidad máxima de la categoría DOBLE no es válida.');
  });
});
