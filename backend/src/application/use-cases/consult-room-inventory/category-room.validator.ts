/** Mayúsculas, sin tildes ni `Ñ`, con letras, dígitos y `_`, de 1 a 50 caracteres (contrato A). */
const CATEGORY_ROOM_FORMAT = /^[A-Z0-9_]{1,50}$/;

/** La `categoryRoom` tiene la forma de la clave que comparten los módulos y Channex. */
export function isValidCategoryRoom(categoryRoom: string): boolean {
  return CATEGORY_ROOM_FORMAT.test(categoryRoom);
}
