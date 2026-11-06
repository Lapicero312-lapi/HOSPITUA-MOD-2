/**
 * Códigos de error que solo usa `check-view-reservation`, con los mensajes literales de la tabla de errores
 * de C1 de su plan (FR-009). Los que comparte con otros casos de uso (código de reserva, estado, fechas,
 * página y búsqueda por nombre) están en `domain/shared/error-codes.ts`.
 * Se lanzan con `new BusinessError(INVALID_CHANNEL.code, INVALID_CHANNEL.message)`.
 */

/** C1: `source` fuera del enumerado. */
export const INVALID_CHANNEL = {
  code: 'INVALID_CHANNEL',
  message: 'El canal indicado no es válido.',
} as const;

/** C1: `order` distinto de `asc` y `desc`. */
export const INVALID_SORT_ORDER = {
  code: 'INVALID_SORT_ORDER',
  message: 'El orden indicado no es válido.',
} as const;

/** C1: `otaId` que no es un UUID. */
export const INVALID_OTA_ID = {
  code: 'INVALID_OTA_ID',
  message: 'La agencia indicada no es válida.',
} as const;

/** C1: `otaId` sin `source=OTA` (plan, "Puntos que este plan propone", punto 1). */
export const AGENCY_REQUIRES_OTA_CHANNEL = {
  code: 'AGENCY_REQUIRES_OTA_CHANNEL',
  message: 'La agencia solo aplica a reservas del canal OTA.',
} as const;

/** C1: `inConflict` con un valor distinto de `true`. */
export const INVALID_CONFLICT_FILTER = {
  code: 'INVALID_CONFLICT_FILTER',
  message: 'El filtro de conflicto no es válido.',
} as const;
