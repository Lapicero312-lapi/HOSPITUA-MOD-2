/**
 * Códigos de error que solo usa `check-room-availability`, con los mensajes literales de su plan
 * ("Reglas de validación y manejo de errores"). Los que comparte con otros casos de uso están en
 * `domain/shared/error-codes.ts`, y los motivos de no disponibilidad (`RESERVED` y `MAINTENANCE`) en
 * `domain/reservation/require-available.ts`.
 * Se lanzan con `new BusinessError(INVALID_AVAILABILITY_QUERY.code, INVALID_AVAILABILITY_QUERY.message)`.
 */

/** Ni categoría ni `roomId`, o ambos a la vez (`hasExactlyCategoryOrRoomId` devuelve `false`). */
export const INVALID_AVAILABILITY_QUERY = {
  code: 'INVALID_AVAILABILITY_QUERY',
  message: 'Debe indicar una categoría o una habitación.',
} as const;
