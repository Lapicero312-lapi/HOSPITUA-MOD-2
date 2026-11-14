import { describe, expect, it } from 'vitest';
import { CountryNames } from '../../../../src/domain/shared/country-names.js';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

/** Todos los códigos de dos letras, de `AA` a `ZZ`, con el nombre que da la tabla. */
const everyTwoLetterCode = LETTERS.flatMap((first) =>
  LETTERS.map((second) => {
    const code = first + second;
    return { code, name: CountryNames.nameOf(code) };
  }),
);
const known = everyTwoLetterCode.filter(({ name }) => name !== null);

describe('CountryNames', () => {
  it.each([
    ['CO', 'Colombia'],
    ['US', 'Estados Unidos'],
    ['VE', 'Venezuela'],
    ['ES', 'España'],
    ['MX', 'México'],
    ['BR', 'Brasil'],
  ])('convierte %s en %s', (code, name) => {
    expect(CountryNames.nameOf(code)).toBe(name);
  });

  it('compara el código sin espacios alrededor y sin distinguir mayúsculas', () => {
    expect(CountryNames.nameOf('co')).toBe('Colombia');
    expect(CountryNames.nameOf(' Us ')).toBe('Estados Unidos');
  });

  it.each([
    ['vacío', ''],
    ['solo espacios', '   '],
    ['nulo', null],
    ['sin enviar', undefined],
  ])('con el código %s la nacionalidad queda vacía', (_caso, code) => {
    expect(CountryNames.nameOf(code)).toBeNull();
  });

  it.each([
    ['un código que no es oficial', 'XK'],
    ['un código reservado', 'ZZ'],
    ['un código de tres letras', 'COL'],
    ['un nombre en lugar del código', 'Colombia'],
    ['una propiedad de los objetos de JavaScript', 'constructor'],
    ['otra propiedad de los objetos de JavaScript', '__proto__'],
  ])('con %s la nacionalidad queda vacía', (_caso, code) => {
    expect(CountryNames.nameOf(code)).toBeNull();
  });

  it('tiene los 249 códigos oficiales de ISO 3166-1 alfa-2, sin repetir nombres', () => {
    expect(known).toHaveLength(249);
    expect(new Set(known.map(({ name }) => name)).size).toBe(249);
  });

  it('cada nombre cabe en guest.nationality, varchar(60)', () => {
    for (const { name } of known) {
      expect(name?.length).toBeLessThanOrEqual(60);
    }
  });

  it('solo CO da Colombia, que es el nombre que decide si el huésped es extranjero', () => {
    expect(
      known.filter(({ name }) => name === 'Colombia').map(({ code }) => code),
    ).toEqual(['CO']);
  });
});
