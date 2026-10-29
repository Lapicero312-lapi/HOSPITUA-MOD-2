/**
 * Códigos de error de la vista de huéspedes alojados que solo usa `process-guest-data`, con los mensajes
 * literales de C1 y C2 de su plan. Los que comparte con otros casos de uso (fechas, página, búsqueda por
 * nombre y referencia de reserva) están en `domain/shared/error-codes.ts`.
 * Se lanzan con `new BusinessError(GUEST_NOT_FOUND.code, GUEST_NOT_FOUND.message)`.
 */

/** C1: `nationality` fuera del enumerado. */
export const INVALID_NATIONALITY_FILTER = {
  code: 'INVALID_NATIONALITY_FILTER',
  message: 'El filtro de nacionalidad no es válido.',
} as const;

/** C1: `presence` fuera del enumerado. */
export const INVALID_PRESENCE_FILTER = {
  code: 'INVALID_PRESENCE_FILTER',
  message: 'El filtro de situación no es válido.',
} as const;

/** C1: búsqueda vacía o con caracteres no permitidos. */
export const INVALID_SEARCH = {
  code: 'INVALID_SEARCH',
  message: 'La búsqueda no es válida.',
} as const;

/** C2: `documentNumber` vacío o con caracteres no permitidos. */
export const INVALID_DOCUMENT_NUMBER = {
  code: 'INVALID_DOCUMENT_NUMBER',
  message: 'El número de documento no es válido.',
} as const;

/** C2: huésped o reserva inexistente, o sin movimientos. */
export const GUEST_NOT_FOUND = {
  code: 'GUEST_NOT_FOUND',
  message: 'El huésped no existe en esa reserva.',
} as const;
