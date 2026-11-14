import { describe, expect, it } from 'vitest';
import { diffRooms } from '../../../../src/domain/reservation/diff-rooms.js';

/** Una habitación actual de la reserva: su número es también su `roomId` y su tarifa la nombra. */
function current(roomNumber: string, categoryRoom: string) {
  return {
    roomId: `uuid-${roomNumber}`,
    roomNumber,
    categoryRoom,
    rate: `tarifa-${roomNumber}`,
  };
}

/** Una habitación pedida, con la categoría que da el Módulo 1. */
function requested(roomNumber: string, categoryRoom: string, guestCount = 2) {
  return { roomId: `uuid-${roomNumber}`, categoryRoom, guestCount };
}

/** Los números de cada lista, para leer las pruebas de un vistazo. */
function summary(
  diff: ReturnType<
    typeof diffRooms<ReturnType<typeof current>, ReturnType<typeof requested>>
  >,
) {
  const number = (room: { roomId: string | null }) =>
    room.roomId?.replace('uuid-', '') ?? null;
  return {
    kept: diff.kept.map(({ current: room }) => number(room)),
    swappedSameCategory: diff.swappedSameCategory.map(
      ({ removed, added }) => `${number(removed)}→${number(added)}`,
    ),
    swappedCategory: diff.swappedCategory.map(
      ({ removed, added }) => `${number(removed)}→${number(added)}`,
    ),
    added: diff.added.map(number),
    removed: diff.removed.map(number),
  };
}

const NOTHING = {
  kept: [],
  swappedSameCategory: [],
  swappedCategory: [],
  added: [],
  removed: [],
};

describe('diffRooms (plan de update-reservation, regla 2 y punto 11)', () => {
  it('la misma lista: todas conservadas, con el guestCount pedido', () => {
    const diff = diffRooms(
      [current('201', 'DOBLE')],
      [requested('201', 'DOBLE', 1)],
    );

    expect(summary(diff)).toEqual({ ...NOTHING, kept: ['201'] });
    expect(diff.kept[0]?.requested.guestCount).toBe(1);
    expect(diff.kept[0]?.current.rate).toBe('tarifa-201');
  });

  it('el ejemplo de B1: se conserva la 201 y se agrega la 305, de otra categoría', () => {
    const diff = diffRooms(
      [current('201', 'DOBLE')],
      [requested('201', 'DOBLE'), requested('305', 'SUITE', 1)],
    );

    expect(summary(diff)).toEqual({
      ...NOTHING,
      kept: ['201'],
      added: ['305'],
    });
  });

  it('una que ya no está se quita', () => {
    const diff = diffRooms(
      [current('201', 'DOBLE'), current('202', 'DOBLE')],
      [requested('201', 'DOBLE')],
    );

    expect(summary(diff)).toEqual({
      ...NOTHING,
      kept: ['201'],
      removed: ['202'],
    });
  });

  it('una por otra de la misma categoría: cambiada, y la nueva hereda la tarifa de la quitada', () => {
    const diff = diffRooms(
      [current('201', 'DOBLE')],
      [requested('202', 'DOBLE')],
    );

    expect(summary(diff)).toEqual({
      ...NOTHING,
      swappedSameCategory: ['201→202'],
    });
    expect(diff.swappedSameCategory[0]?.removed.rate).toBe('tarifa-201');
  });

  it('una por otra de distinta categoría: cambiada de categoría (no agregada y quitada)', () => {
    const diff = diffRooms(
      [current('201', 'DOBLE')],
      [requested('305', 'SUITE')],
    );

    expect(summary(diff)).toEqual({ ...NOTHING, swappedCategory: ['201→305'] });
  });

  describe('el emparejamiento tiene un orden fijo', () => {
    it('las quitadas por roomNumber ascendente: de la 201 y la 202, la 305 hereda la de la 201', () => {
      // La reserva las trae en otro orden: 202 primero.
      const diff = diffRooms(
        [current('202', 'DOBLE'), current('201', 'DOBLE')],
        [requested('305', 'DOBLE')],
      );

      expect(summary(diff)).toEqual({
        ...NOTHING,
        swappedSameCategory: ['201→305'],
        removed: ['202'],
      });
    });

    it('el roomNumber se compara como número: la 99 va antes que la 101', () => {
      const diff = diffRooms(
        [current('101', 'DOBLE'), current('99', 'DOBLE')],
        [requested('305', 'DOBLE')],
      );

      expect(summary(diff).swappedSameCategory).toEqual(['99→305']);
    });

    it('las agregadas en el orden de la solicitud', () => {
      const diff = diffRooms(
        [current('201', 'DOBLE')],
        [requested('306', 'DOBLE'), requested('305', 'DOBLE')],
      );

      expect(summary(diff)).toEqual({
        ...NOTHING,
        swappedSameCategory: ['201→306'],
        added: ['305'],
      });
    });

    it('la misma categoría se empareja antes que otra, aunque la otra venga primero en la solicitud', () => {
      const diff = diffRooms(
        [current('201', 'DOBLE')],
        [requested('401', 'SUITE'), requested('202', 'DOBLE')],
      );

      expect(summary(diff)).toEqual({
        ...NOTHING,
        swappedSameCategory: ['201→202'],
        added: ['401'],
      });
    });

    it('cada quitada busca su categoría: dos categorías a la vez', () => {
      const diff = diffRooms(
        [current('201', 'DOBLE'), current('301', 'SUITE')],
        [requested('302', 'SUITE'), requested('202', 'DOBLE')],
      );

      expect(summary(diff)).toEqual({
        ...NOTHING,
        swappedSameCategory: ['201→202', '301→302'],
      });
    });

    it('las que sobran de distinta categoría se emparejan entre sí, en el mismo orden', () => {
      const diff = diffRooms(
        [
          current('202', 'DOBLE'),
          current('201', 'DOBLE'),
          current('101', 'SENCILLA'),
        ],
        [requested('402', 'SUITE'), requested('401', 'SUITE')],
      );

      expect(summary(diff)).toEqual({
        ...NOTHING,
        swappedCategory: ['101→402', '201→401'],
        removed: ['202'],
      });
    });

    it('con más agregadas que quitadas, las que sobran quedan agregadas', () => {
      const diff = diffRooms(
        [current('201', 'DOBLE')],
        [requested('401', 'SUITE'), requested('402', 'SUITE')],
      );

      expect(summary(diff)).toEqual({
        ...NOTHING,
        swappedCategory: ['201→401'],
        added: ['402'],
      });
    });

    it('una habitación sin asignar (sin roomNumber) va después de las que tienen número', () => {
      const unassigned = {
        roomId: null,
        roomNumber: null,
        categoryRoom: 'DOBLE',
        rate: 'sin-tarifa',
      };
      const diff = diffRooms(
        [unassigned, current('201', 'DOBLE')],
        [requested('202', 'DOBLE')],
      );

      expect(diff.swappedSameCategory[0]?.removed.roomNumber).toBe('201');
      expect(diff.removed).toEqual([unassigned]);
    });
  });

  it('una conservada no entra en ningún emparejamiento', () => {
    const diff = diffRooms(
      [current('201', 'DOBLE'), current('202', 'DOBLE')],
      [requested('202', 'DOBLE'), requested('203', 'DOBLE')],
    );

    expect(summary(diff)).toEqual({
      ...NOTHING,
      kept: ['202'],
      swappedSameCategory: ['201→203'],
    });
  });

  it('las conservadas salen en el orden de la solicitud', () => {
    const diff = diffRooms(
      [current('201', 'DOBLE'), current('202', 'DOBLE')],
      [requested('202', 'DOBLE'), requested('201', 'DOBLE')],
    );

    expect(summary(diff).kept).toEqual(['202', '201']);
  });

  it('devuelve las mismas habitaciones que recibe, con todos sus campos', () => {
    const before = current('201', 'DOBLE');
    const after = requested('305', 'SUITE', 3);

    const diff = diffRooms([before], [after]);

    expect(diff.swappedCategory[0]?.removed).toBe(before);
    expect(diff.swappedCategory[0]?.added).toBe(after);
  });

  it('no cambia las listas que recibe', () => {
    const before = [current('202', 'DOBLE'), current('201', 'DOBLE')];
    const after = [requested('305', 'DOBLE')];

    diffRooms(before, after);

    expect(before.map((room) => room.roomNumber)).toEqual(['202', '201']);
    expect(after).toHaveLength(1);
  });

  it('una pedida repetida es un error del programa: el validador la rechaza antes', () => {
    expect(() =>
      diffRooms(
        [current('201', 'DOBLE')],
        [requested('201', 'DOBLE'), requested('201', 'DOBLE')],
      ),
    ).toThrow(Error);
  });
});
