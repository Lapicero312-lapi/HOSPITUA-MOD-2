/**
 * Códigos de error que solo usa `register-ota-information-commission`, con los mensajes literales de las
 * tablas de A1, A2, A3, B1 y B2 de su plan. Los que comparte con otros casos de uso están en
 * `domain/shared/error-codes.ts`, e `INVALID_OTA_DATA` lo lanza la propia `Ota` (`domain/ota/ota.ts`).
 * Se lanzan con `new BusinessError(OTA_NOT_FOUND.code, OTA_NOT_FOUND.message)`.
 */

/** A1: `commissionStatus` distinto de `CALCULATED`, `RECONCILED` o `PAID`. */
export const INVALID_COMMISSION_STATUS = {
  code: 'INVALID_COMMISSION_STATUS',
  message: 'El estado de la comisión no es válido.',
} as const;

/** A2: cuerpo vacío, `items` vacío o con más de `RECONCILIATION_MAX_ITEMS`. */
export const INVALID_RECONCILIATION_REQUEST = {
  code: 'INVALID_RECONCILIATION_REQUEST',
  message: 'La solicitud de conciliación no es válida.',
} as const;

/** A2: `action` distinta de `RECONCILED` o `PAID`. */
export const INVALID_RECONCILIATION_ACTION = {
  code: 'INVALID_RECONCILIATION_ACTION',
  message: 'La acción de conciliación no es válida.',
} as const;

/** A2: importe con formato inválido o negativo. */
export const INVALID_AMOUNT = {
  code: 'INVALID_AMOUNT',
  message: 'El importe no es válido.',
} as const;

/** A3 y B1: la `Ota` no existe. */
export const OTA_NOT_FOUND = {
  code: 'OTA_NOT_FOUND',
  message: 'La agencia no existe.',
} as const;

/** B2: el `name` coincide con el de otra `Ota`. */
export const OTA_NAME_ALREADY_EXISTS = {
  code: 'OTA_NAME_ALREADY_EXISTS',
  message: 'Ya existe una agencia con ese nombre.',
} as const;

/** B1: el porcentaje de la agencia, o el calculado con la primera reserva, es menor que 0 o mayor que 100. */
export const INVALID_COMMISSION_PERCENTAGE = {
  code: 'INVALID_COMMISSION_PERCENTAGE',
  message: 'El porcentaje de comisión no es válido.',
} as const;

/**
 * B1: la agencia no tiene porcentaje y la revisión no trae `ota_commission`, o trae un `grossAmount` de 0:
 * no se puede calcular el porcentaje con la primera reserva.
 */
export const COMMISSION_NOT_REPORTED = {
  code: 'COMMISSION_NOT_REPORTED',
  message:
    'Booking no informó la comisión de la primera reserva de la agencia.',
} as const;

/** B1: el `externalConfirmationCode` ya existe para esa `Ota`. */
export const DUPLICATE_CONFIRMATION_CODE = {
  code: 'DUPLICATE_CONFIRMATION_CODE',
  message: 'El código de confirmación ya está registrado para esta agencia.',
} as const;
