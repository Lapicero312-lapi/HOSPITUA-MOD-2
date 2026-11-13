import { describe, expect, it } from 'vitest';
import type { Room } from '../../../../src/application/integration/room.js';
import {
  groupRoomsByCategory,
  toChannexRanges,
} from '../../../../src/domain/ota/channex-grouping.js';

const room = (
  roomNumber: string,
  categoryRoom: string,
  maxCapacity: number,
): Room => ({
  id: `00000000-0000-4000-8000-${roomNumber.padStart(12, '0')}`,
  roomNumber,
  categoryRoom,
  maxCapacity,
});

describe('groupRoomsByCategory (C1, paso 1; T003 de configure-ota)', () => {
  it('el ejemplo del simulador: la 201, la 202 y la 1001 de DOBLE y la 101 de SUITE_JUNIOR', () => {
    expect(
      groupRoomsByCategory([
        room('201', 'DOBLE', 2),
        room('202', 'DOBLE', 3),
        room('1001', 'DOBLE', 2),
        room('101', 'SUITE_JUNIOR', 2),
      ]),
    ).toEqual([
      { categoryRoom: 'DOBLE', countOfRooms: 3, occupancy: 3 },
      { categoryRoom: 'SUITE_JUNIOR', countOfRooms: 1, occupancy: 2 },
    ]);
  });

  it('la capacidad es la mayor, aunque llegue al final', () => {
    expect(
      groupRoomsByCategory([
        room('201', 'DOBLE', 2),
        room('202', 'DOBLE', 2),
        room('203', 'DOBLE', 4),
      ]),
    ).toEqual([{ categoryRoom: 'DOBLE', countOfRooms: 3, occupancy: 4 }]);
  });

  it('el orden de llegada no cambia el resultado: va ordenado por categoría', () => {
    const rooms = [
      room('101', 'SUITE_JUNIOR', 2),
      room('201', 'DOBLE', 2),
      room('301', 'FAMILIAR', 5),
    ];

    expect(groupRoomsByCategory(rooms)).toEqual(
      groupRoomsByCategory([...rooms].reverse()),
    );
    expect(
      groupRoomsByCategory(rooms).map(({ categoryRoom }) => categoryRoom),
    ).toEqual(['DOBLE', 'FAMILIAR', 'SUITE_JUNIOR']);
  });

  it('sin habitaciones, ninguna categoría', () => {
    expect(groupRoomsByCategory([])).toEqual([]);
  });
});

describe('toChannexRanges (A4; T003 de configure-ota)', () => {
  it('las noches seguidas con el mismo valor van en un rango, con las dos fechas incluidas', () => {
    expect(
      toChannexRanges([
        { date: '2026-11-10', availability: 2 },
        { date: '2026-11-11', availability: 2 },
        { date: '2026-11-12', availability: 2 },
      ]),
    ).toEqual([
      { dateFrom: '2026-11-10', dateTo: '2026-11-12', availability: 2 },
    ]);
  });

  it('un cambio de valor abre otro rango', () => {
    expect(
      toChannexRanges([
        { date: '2026-11-10', availability: 2 },
        { date: '2026-11-11', availability: 1 },
        { date: '2026-11-12', availability: 1 },
        { date: '2026-11-13', availability: 2 },
      ]),
    ).toEqual([
      { dateFrom: '2026-11-10', dateTo: '2026-11-10', availability: 2 },
      { dateFrom: '2026-11-11', dateTo: '2026-11-12', availability: 1 },
      { dateFrom: '2026-11-13', dateTo: '2026-11-13', availability: 2 },
    ]);
  });

  it('una noche que falta corta el rango aunque el valor sea el mismo', () => {
    expect(
      toChannexRanges([
        { date: '2026-11-10', availability: 0 },
        { date: '2026-11-12', availability: 0 },
      ]),
    ).toEqual([
      { dateFrom: '2026-11-10', dateTo: '2026-11-10', availability: 0 },
      { dateFrom: '2026-11-12', dateTo: '2026-11-12', availability: 0 },
    ]);
  });

  it('cruza fin de mes y de año', () => {
    expect(
      toChannexRanges([
        { date: '2026-12-31', availability: 3 },
        { date: '2027-01-01', availability: 3 },
        { date: '2026-12-30', availability: 3 },
      ]),
    ).toEqual([
      { dateFrom: '2026-12-30', dateTo: '2027-01-01', availability: 3 },
    ]);
  });

  it('las noches desordenadas salen en orden de fecha', () => {
    expect(
      toChannexRanges([
        { date: '2026-11-12', availability: 1 },
        { date: '2026-11-10', availability: 2 },
        { date: '2026-11-11', availability: 2 },
      ]),
    ).toEqual([
      { dateFrom: '2026-11-10', dateTo: '2026-11-11', availability: 2 },
      { dateFrom: '2026-11-12', dateTo: '2026-11-12', availability: 1 },
    ]);
  });

  it('sin noches, ningún rango', () => {
    expect(toChannexRanges([])).toEqual([]);
  });

  it.each(['2026-02-30', '2026-11-1', 'mañana'])(
    'una fecha que no es real (%s) es un error del programa',
    (date) => {
      expect(() => toChannexRanges([{ date, availability: 1 }])).toThrow(date);
    },
  );

  it('una noche repetida es un error del programa', () => {
    expect(() =>
      toChannexRanges([
        { date: '2026-11-10', availability: 1 },
        { date: '2026-11-10', availability: 2 },
      ]),
    ).toThrow('dos veces');
  });
});
