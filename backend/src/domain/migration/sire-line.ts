import { BusinessError } from '../shared/business-error.js';
import type { MovementType } from '../shared/enums.js';
import { INVALID_GUEST_CHARACTERS } from '../shared/error-codes.js';

/**
 * Un movimiento migratorio con los datos de su huésped, la forma de `SireMovement` de `process-guest-data`
 * (plan de `export-sire-file`, punto 12). Las fechas son `AAAA-MM-DD`.
 */
export type SireLineMovement = {
  movementType: MovementType;
  movementDate: string;
  guest: {
    firstName: string;
    lastName: string;
    documentType: string;
    documentNumber: string;
    birthDate: string;
    nationality: string;
    originPlace: string | null;
    destinationPlace: string | null;
  };
};

/**
 * El formato de la línea, de la configuración `SIRE_*`. `fieldSeparator` es el carácter mismo (el
 * tabulador, no la palabra `TAB`); `dateFormat` tiene `dd`, `MM` y `yyyy`.
 */
export type SireLineFormat = {
  hotelCode: string;
  cityCode: string;
  fieldSeparator: string;
  dateFormat: string;
  encoding: 'utf-8' | 'latin1';
};

/** Un campo de la línea, como lo muestra la vista previa (plan, C). */
export type SireField = { position: number; name: string; value: string };

/** Los 12 campos y la línea que forman, sin el fin de línea: lo agrega quien arma el archivo. */
export type SireLine = { fields: SireField[]; line: string };

/** `ENTRY` → `E` y `DEPARTURE` → `S` (campo 8). */
const MOVEMENT_LETTERS: Record<MovementType, string> = {
  ENTRY: 'E',
  DEPARTURE: 'S',
};

/** Una mitad suelta de un par sustituto: no tiene representación en UTF-8. */
const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** Un carácter por encima de U+00FF: no cabe en `latin1`. */
const OUTSIDE_LATIN1 = /[\u{100}-\u{10FFFF}]/u;

const LINE_BREAK = /[\r\n]/;

/**
 * La línea de un movimiento en el archivo SIRE (plan de `export-sire-file`, "Formato de la línea" y punto
 * 12). Es la misma para el archivo, la vista previa y la descarga individual. Los datos salen tal como
 * llegaron del Módulo 1: solo se pasan a mayúsculas los nombres y apellidos, y se da formato a las fechas.
 * @throws BusinessError `INVALID_GUEST_CHARACTERS` si un campo contiene el separador, un salto de línea o
 * un carácter que no se puede codificar con `encoding`.
 */
export function formatSireLine(
  movement: SireLineMovement,
  format: SireLineFormat,
): SireLine {
  const guest = movement.guest;
  const values = [
    format.hotelCode,
    format.cityCode,
    guest.documentType,
    guest.documentNumber,
    guest.nationality,
    guest.lastName.toUpperCase(),
    guest.firstName.toUpperCase(),
    MOVEMENT_LETTERS[movement.movementType],
    formatDate(movement.movementDate, format.dateFormat),
    guest.originPlace ?? '',
    guest.destinationPlace ?? '',
    formatDate(guest.birthDate, format.dateFormat),
  ];
  for (const value of values) {
    if (!fits(value, format)) {
      throw new BusinessError(
        INVALID_GUEST_CHARACTERS.code,
        INVALID_GUEST_CHARACTERS.message,
      );
    }
  }
  return {
    fields: values.map((value, index) => ({
      position: index + 1,
      name: FIELD_NAMES[index] ?? '',
      value,
    })),
    line: values.join(format.fieldSeparator),
  };
}

/** Los nombres de los campos, en orden, como los muestra la vista previa (plan, C). */
const FIELD_NAMES = [
  'Código del hotel',
  'Código de la ciudad',
  'Tipo de documento',
  'Número de documento',
  'Nacionalidad',
  'Apellidos',
  'Nombres',
  'Tipo de movimiento',
  'Fecha del movimiento',
  'Lugar de procedencia',
  'Lugar de destino',
  'Fecha de nacimiento',
] as const;

/** `AAAA-MM-DD` con el formato configurado: `yyyy`, `MM` y `dd` se reemplazan por el año, el mes y el día. */
function formatDate(date: string, dateFormat: string): string {
  const [year = '', month = '', day = ''] = date.split('-');
  return dateFormat
    .replaceAll('yyyy', year)
    .replaceAll('MM', month)
    .replaceAll('dd', day);
}

/**
 * Si el valor se puede escribir en un campo sin romper la línea ni la codificación del archivo. Se revisa
 * el valor que se escribe, ya en mayúsculas: `ÿ` cabe en `latin1`, pero su mayúscula `Ÿ` (U+0178) no.
 */
function fits(value: string, format: SireLineFormat): boolean {
  if (value.includes(format.fieldSeparator) || LINE_BREAK.test(value)) {
    return false;
  }
  return format.encoding === 'latin1'
    ? !OUTSIDE_LATIN1.test(value)
    : !LONE_SURROGATE.test(value);
}
