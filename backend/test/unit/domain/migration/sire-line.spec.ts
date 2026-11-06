import { describe, expect, it } from 'vitest';
import {
  formatSireLine,
  type SireLineFormat,
  type SireLineMovement,
} from '../../../../src/domain/migration/sire-line.js';

/** El formato por defecto del plan, con el hotel y la ciudad del ejemplo de C. */
const FORMAT: SireLineFormat = {
  hotelCode: '123456',
  cityCode: '11001',
  fieldSeparator: '\t',
  dateFormat: 'dd/MM/yyyy',
  encoding: 'utf-8',
};

const LATIN1: SireLineFormat = { ...FORMAT, encoding: 'latin1' };

/** La entrada de John Smith del ejemplo de C. */
const ENTRY: SireLineMovement = {
  movementType: 'ENTRY',
  movementDate: '2026-10-09',
  guest: {
    firstName: 'John',
    lastName: 'Smith',
    documentType: 'PAS',
    documentNumber: 'X99',
    birthDate: '1990-05-12',
    nationality: 'Estados Unidos',
    originPlace: 'Miami, Estados Unidos',
    destinationPlace: 'Cartagena, Colombia',
  },
};

function withGuest(
  changes: Partial<SireLineMovement['guest']>,
): SireLineMovement {
  return { ...ENTRY, guest: { ...ENTRY.guest, ...changes } };
}

const valueAt = (movement: SireLineMovement, position: number) =>
  formatSireLine(movement, FORMAT).fields[position - 1]?.value;

describe('formatSireLine (plan de export-sire-file, "Formato de la línea" y punto 12)', () => {
  it('el ejemplo de C: los 12 campos en orden, con su nombre, y la línea exacta', () => {
    expect(formatSireLine(ENTRY, FORMAT)).toEqual({
      fields: [
        { position: 1, name: 'Código del hotel', value: '123456' },
        { position: 2, name: 'Código de la ciudad', value: '11001' },
        { position: 3, name: 'Tipo de documento', value: 'PAS' },
        { position: 4, name: 'Número de documento', value: 'X99' },
        { position: 5, name: 'Nacionalidad', value: 'Estados Unidos' },
        { position: 6, name: 'Apellidos', value: 'SMITH' },
        { position: 7, name: 'Nombres', value: 'JOHN' },
        { position: 8, name: 'Tipo de movimiento', value: 'E' },
        { position: 9, name: 'Fecha del movimiento', value: '09/10/2026' },
        {
          position: 10,
          name: 'Lugar de procedencia',
          value: 'Miami, Estados Unidos',
        },
        {
          position: 11,
          name: 'Lugar de destino',
          value: 'Cartagena, Colombia',
        },
        { position: 12, name: 'Fecha de nacimiento', value: '12/05/1990' },
      ],
      line: '123456\t11001\tPAS\tX99\tEstados Unidos\tSMITH\tJOHN\tE\t09/10/2026\tMiami, Estados Unidos\tCartagena, Colombia\t12/05/1990',
    });
  });

  it('la línea no lleva el fin de línea: lo agrega quien arma el archivo', () => {
    expect(formatSireLine(ENTRY, FORMAT).line).not.toMatch(/[\r\n]$/);
  });

  it('la salida es S, con su propia fecha', () => {
    const departure: SireLineMovement = {
      ...ENTRY,
      movementType: 'DEPARTURE',
      movementDate: '2026-10-12',
    };

    expect(valueAt(departure, 8)).toBe('S');
    expect(valueAt(departure, 9)).toBe('12/10/2026');
  });

  it('nombres y apellidos en mayúsculas, con tildes y ñ (punto 8)', () => {
    const guest = withGuest({ firstName: 'José Ángel', lastName: 'Muñoz' });

    expect(valueAt(guest, 6)).toBe('MUÑOZ');
    expect(valueAt(guest, 7)).toBe('JOSÉ ÁNGEL');
  });

  it('tipo de documento, número y nacionalidad salen tal cual, sin mayúsculas ni recortes', () => {
    const guest = withGuest({
      documentNumber: 'ab-12 ',
      nationality: 'estados unidos',
    });

    expect(valueAt(guest, 4)).toBe('ab-12 ');
    expect(valueAt(guest, 5)).toBe('estados unidos');
  });

  it('procedencia y destino nulos salen vacíos, y la línea conserva los 12 campos', () => {
    const result = formatSireLine(
      withGuest({ originPlace: null, destinationPlace: null }),
      FORMAT,
    );

    expect(result.fields[9]?.value).toBe('');
    expect(result.fields[10]?.value).toBe('');
    expect(result.line.split('\t')).toHaveLength(12);
  });

  describe('fechas con SIRE_DATE_FORMAT', () => {
    it.each([
      ['dd/MM/yyyy', '09/10/2026', '12/05/1990'],
      ['yyyy-MM-dd', '2026-10-09', '1990-05-12'],
      ['MM.dd.yyyy', '10.09.2026', '05.12.1990'],
    ])('%s', (dateFormat, movementDate, birthDate) => {
      const result = formatSireLine(ENTRY, { ...FORMAT, dateFormat });

      expect(result.fields[8]?.value).toBe(movementDate);
      expect(result.fields[11]?.value).toBe(birthDate);
    });
  });

  it('usa el separador configurado', () => {
    const result = formatSireLine(ENTRY, { ...FORMAT, fieldSeparator: '|' });

    expect(result.line).toBe(
      '123456|11001|PAS|X99|Estados Unidos|SMITH|JOHN|E|09/10/2026|Miami, Estados Unidos|Cartagena, Colombia|12/05/1990',
    );
  });

  describe('INVALID_GUEST_CHARACTERS: un campo que rompería la línea o el archivo', () => {
    const rejects = (movement: SireLineMovement, format = FORMAT) =>
      expect(() => formatSireLine(movement, format)).toThrow(
        expect.objectContaining({
          errorCode: 'INVALID_GUEST_CHARACTERS',
          message: 'Caracteres no válidos en el registro del huésped.',
        }),
      );

    it('con el separador dentro de un dato (punto 7)', () => {
      rejects(withGuest({ originPlace: 'Miami\tFlorida' }));
    });

    it('con el separador configurado, aunque no sea el tabulador', () => {
      rejects(withGuest({ destinationPlace: 'Cartagena | Colombia' }), {
        ...FORMAT,
        fieldSeparator: '|',
      });
    });

    it.each([
      ['\\n', 'Smith\nJr'],
      ['\\r', 'Smith\rJr'],
    ])('con un salto de línea %s (punto 7)', (_caso, lastName) => {
      rejects(withGuest({ lastName }));
    });

    it.each([
      ['una mitad alta suelta', 'Jo\uD83Dhn'],
      ['una mitad baja suelta', 'Jo\uDE00hn'],
    ])('en utf-8, %s de un par sustituto', (_caso, firstName) => {
      rejects(withGuest({ firstName }));
    });

    it('en latin1, un carácter por encima de U+00FF', () => {
      rejects(withGuest({ lastName: 'Şahin' }), LATIN1);
    });

    it('en latin1, un campo que sale tal cual también se revisa (la nacionalidad)', () => {
      rejects(withGuest({ nationality: 'Türkiye 🇹🇷' }), LATIN1);
    });

    it('en latin1 se revisa lo que se escribe: ÿ cabe, pero su mayúscula Ÿ (U+0178) no', () => {
      rejects(withGuest({ firstName: 'Zoÿ' }), LATIN1);
    });
  });

  describe('lo que sí se puede codificar', () => {
    it('en utf-8, un par sustituto completo (un emoji) y caracteres de otros alfabetos', () => {
      expect(valueAt(withGuest({ firstName: 'Şahin 😀' }), 7)).toBe('ŞAHIN 😀');
    });

    it('en latin1, las tildes y la ñ (hasta U+00FF)', () => {
      const result = formatSireLine(
        withGuest({ lastName: 'Muñoz Ñandú', originPlace: 'Málaga, España' }),
        LATIN1,
      );

      expect(result.fields[5]?.value).toBe('MUÑOZ ÑANDÚ');
      expect(result.fields[9]?.value).toBe('Málaga, España');
    });
  });
});
