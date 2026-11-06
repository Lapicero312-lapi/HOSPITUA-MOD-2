/**
 * Validadores de la cotización (T005), antes de llamar al Módulo 3: la forma acordada de `categoryRoom`
 * y las fechas de la estadía.
 */

/** Mayúsculas, sin tildes ni `Ñ`, con letras, dígitos y `_`, de 1 a 50 caracteres (`consult-room-inventory`, A). */
const CATEGORY_ROOM_FORMAT = /^[A-Z0-9_]{1,50}$/;

const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

export function isValidCategoryRoom(categoryRoom: string): boolean {
  return CATEGORY_ROOM_FORMAT.test(categoryRoom);
}

/**
 * Las dos fechas son `AAAA-MM-DD` reales y la salida (`endDate`) es posterior a la llegada
 * (`startDate`). En `AAAA-MM-DD`, el orden del texto es el de las fechas.
 */
export function isValidStayDates(startDate: string, endDate: string): boolean {
  return isRealDate(startDate) && isRealDate(endDate) && endDate > startDate;
}

/**
 * La fecha existe en el calendario: con un día que ese mes no tiene (por ejemplo `2026-02-30`), `Date` la
 * corre al mes siguiente y deja de coincidir. Se lee en UTC para que no dependa de la zona del computador.
 */
function isRealDate(value: string): boolean {
  if (!DATE_FORMAT.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}
