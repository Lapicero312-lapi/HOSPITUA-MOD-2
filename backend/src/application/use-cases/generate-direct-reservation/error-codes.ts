/**
 * Códigos de error que solo usa `generate-direct-reservation`, con los mensajes literales de la tabla C de
 * su plan. Los que comparte con otros casos de uso están en `domain/shared/error-codes.ts`, y los que ya
 * lanza el dominio (`INVALID_ROOM_COUNT`, `GUEST_COUNT_TOO_LOW`, `NOTES_TOO_LONG`…) se quedan donde están.
 * Se lanzan con `new BusinessError(INVALID_DOCUMENT_TYPE.code, INVALID_DOCUMENT_TYPE.message)`.
 */

/** `documentType` no es `RC`, `TI`, `CC`, `CE`, `PAS` ni `NIT`. */
export const INVALID_DOCUMENT_TYPE = {
  code: 'INVALID_DOCUMENT_TYPE',
  message: 'El tipo de documento no es válido.',
} as const;

/** `contactEmail` del titular con formato inválido. */
export const INVALID_EMAIL = {
  code: 'INVALID_EMAIL',
  message: 'El correo electrónico no es válido.',
} as const;

/** `guestCount` de una habitación no es un entero positivo (el `0` es `GUEST_COUNT_TOO_LOW`, del dominio). */
export const INVALID_GUEST_COUNT = {
  code: 'INVALID_GUEST_COUNT',
  message: 'La cantidad de personas debe ser un número entero mayor que cero.',
} as const;

/** `VerifyAvailability` encuentra menos habitaciones disponibles que las pedidas por categoría. */
export const NO_AVAILABILITY = {
  code: 'NO_AVAILABILITY',
  message:
    'Error 400: La habitación no está disponible para el rango de fechas solicitado',
} as const;

/**
 * Otra solicitud tomó la última habitación: la restricción anti-solape rechazó el guardado y no quedó otra
 * habitación candidata (D3).
 */
export const AVAILABILITY_TAKEN = {
  code: 'AVAILABILITY_TAKEN',
  message: 'Ya no hay disponibilidad para las fechas solicitadas.',
} as const;

/** B: falta la cabecera `Idempotency-Key` o no es un UUID. */
export const IDEMPOTENCY_KEY_REQUIRED = {
  code: 'IDEMPOTENCY_KEY_REQUIRED',
  message: 'Falta el identificador de la solicitud.',
} as const;

/** B: la misma `Idempotency-Key` llega con otro cuerpo. */
export const IDEMPOTENCY_KEY_REUSED = {
  code: 'IDEMPOTENCY_KEY_REUSED',
  message: 'La solicitud ya se usó con otros datos.',
} as const;
