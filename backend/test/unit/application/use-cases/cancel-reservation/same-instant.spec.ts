import { describe, expect, it } from 'vitest';
import { isSameInstant } from '../../../../../src/application/use-cases/cancel-reservation/same-instant.js';

/** Cómo entrega la base `updated_at` y cómo lo envía la pantalla (plan de `cancel-reservation`, A). */
const FROM_DATABASE = '2026-10-08 15:42:10.123456-05';
const FROM_SCREEN = '2026-10-08T15:42:10.123456-05:00';

describe('isSameInstant (plan de cancel-reservation, punto 10, paso 4)', () => {
  it('el texto de la base y el de la pantalla son el mismo instante', () => {
    expect(isSameInstant(FROM_SCREEN, FROM_DATABASE)).toBe(true);
  });

  it('el mismo instante en UTC y en hora de Colombia coincide', () => {
    expect(isSameInstant('2026-10-08T20:42:10.123456Z', FROM_DATABASE)).toBe(
      true,
    );
    expect(isSameInstant('2026-10-09T01:42:10.123456+05:00', FROM_SCREEN)).toBe(
      true,
    );
  });

  it('un microsegundo de diferencia no coincide', () => {
    expect(
      isSameInstant('2026-10-08T15:42:10.123457-05:00', FROM_DATABASE),
    ).toBe(false);
    expect(
      isSameInstant('2026-10-08T15:42:10.123455-05:00', FROM_DATABASE),
    ).toBe(false);
  });

  it('la misma hora en otra zona no coincide', () => {
    expect(
      isSameInstant('2026-10-08T15:42:10.123456-04:00', FROM_DATABASE),
    ).toBe(false);
  });

  it('la base no escribe los ceros del final: 10.5 es 10.500000', () => {
    expect(
      isSameInstant(
        '2026-10-08T15:42:10.500000-05:00',
        '2026-10-08 15:42:10.5-05',
      ),
    ).toBe(true);
    expect(
      isSameInstant(
        '2026-10-08T15:42:10.000000-05:00',
        '2026-10-08 15:42:10-05',
      ),
    ).toBe(true);
    expect(
      isSameInstant(
        '2026-10-08T15:42:10.000005-05:00',
        '2026-10-08 15:42:10.5-05',
      ),
    ).toBe(false);
  });
  it('los microsegundos no se mezclan con los segundos: 10.000000 no es 09.001000', () => {
    // Si los milisegundos no se pasaran a microsegundos, los dos darían el mismo número.
    expect(
      isSameInstant(
        '2026-10-08T15:42:10.000000-05:00',
        '2026-10-08 15:42:09.001-05',
      ),
    ).toBe(false);
    expect(
      isSameInstant(
        '2026-10-08T15:42:10.001000-05:00',
        '2026-10-08 15:42:10.001-05',
      ),
    ).toBe(true);
  });
  it.each([
    ['el año', '2025-10-08T15:42:10.123456-05:00'],
    ['el mes', '2026-09-08T15:42:10.123456-05:00'],
    ['el día', '2026-10-09T15:42:10.123456-05:00'],
    ['la hora', '2026-10-08T16:42:10.123456-05:00'],
    ['los minutos', '2026-10-08T15:43:10.123456-05:00'],
    ['los segundos', '2026-10-08T15:42:11.123456-05:00'],
  ])(
    'con los mismos decimales, si solo cambia %s no es el mismo instante',
    (_part, other) => {
      expect(isSameInstant(other, FROM_DATABASE)).toBe(false);
    },
  );

  it('los minutos de la zona cuentan: +05:30 no es +05:00', () => {
    expect(
      isSameInstant(
        '2026-10-08T15:42:10.123456+05:30',
        '2026-10-08 15:42:10.123456+05',
      ),
    ).toBe(false);
    // 15:12 en +05:00 y 15:42 en +05:30 son las 10:12 UTC.
    expect(
      isSameInstant(
        '2026-10-08T15:12:10.123456+05:00',
        '2026-10-08T15:42:10.123456+05:30',
      ),
    ).toBe(true);
  });

  it('un texto que no es una fecha con hora y zona no coincide con nada, ni consigo mismo', () => {
    expect(isSameInstant('ayer', FROM_DATABASE)).toBe(false);
    expect(isSameInstant(FROM_DATABASE, 'ayer')).toBe(false);
    expect(isSameInstant('ayer', 'ayer')).toBe(false);
    // Sin zona no se sabe qué instante es.
    expect(isSameInstant('2026-10-08T15:42:10.123456', FROM_DATABASE)).toBe(
      false,
    );
    expect(isSameInstant('', '')).toBe(false);
  });
});
