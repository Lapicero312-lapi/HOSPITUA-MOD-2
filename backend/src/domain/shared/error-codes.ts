/**
 * Códigos de error de negocio que comparten varios casos de uso, cada uno con su único mensaje (guía de
 * planes: "Cada `errorCode` tiene un solo mensaje en todo el Módulo 2"). Se lanzan con
 * `new BusinessError(INVALID_ROOM_ID.code, INVALID_ROOM_ID.message)`.
 */

/** `roomId` vacío o que no es un UUID, o habitación que el Módulo 1 no reconoce (404 o 400). */
export const INVALID_ROOM_ID = {
  code: 'INVALID_ROOM_ID',
  message: 'El identificador de la habitación es inválido.',
} as const;

/** Fecha mal formada o inexistente, o `endDate` no posterior a `startDate`. */
export const INVALID_STAY_DATES = {
  code: 'INVALID_STAY_DATES',
  message: 'Rango de fechas inválido. Verifique las fechas seleccionadas.',
} as const;

/** El Módulo 1 no responde, falla o responde algo incoherente: nunca se asume que la habitación está libre. */
export const MAINTENANCE_CHECK_UNAVAILABLE = {
  code: 'MAINTENANCE_CHECK_UNAVAILABLE',
  message:
    'No es posible validar mantenimientos en este momento. Intente de nuevo.',
} as const;
