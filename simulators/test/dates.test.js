import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addDays, isRealDate, todayInHotel } from '../src/dates.js';

describe('Fechas de los simuladores', () => {
  describe('todayInHotel: el día de hoy en Bogotá, no en UTC', () => {
    it('a las 10 p. m. en Bogotá, que ya es el día siguiente en UTC, sigue siendo hoy', () => {
      assert.equal(
        todayInHotel(new Date('2026-10-12T03:00:00Z')),
        '2026-10-11',
      );
    });

    it('a la medianoche en Bogotá ya es el día siguiente', () => {
      assert.equal(
        todayInHotel(new Date('2026-10-12T05:00:00Z')),
        '2026-10-12',
      );
    });
  });

  describe('isRealDate', () => {
    for (const valid of ['2026-10-11', '2028-02-29']) {
      it(`${valid} es una fecha real`, () => {
        assert.equal(isRealDate(valid), true);
      });
    }

    for (const [caso, value] of [
      ['sin el día', '2026-10'],
      ['un día que no existe', '2026-02-30'],
      ['el 29 de febrero de un año no bisiesto', '2026-02-29'],
      ['otro orden', '11-10-2026'],
      ['con la hora', '2026-10-11T00:00:00Z'],
      ['vacía', ''],
      ['un número', 20261011],
      ['nula', null],
    ]) {
      it(`${caso} no es una fecha real`, () => {
        assert.equal(isRealDate(value), false);
      });
    }
  });

  it('addDays cambia de mes y de año, hacia adelante y hacia atrás', () => {
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  });
});
