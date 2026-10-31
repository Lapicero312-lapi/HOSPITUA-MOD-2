/**
 * Códigos de error que solo usa `export-sire-file`, con los mensajes literales de la tabla D de su plan
 * (los del spec cuando existen). Los que comparte con otros casos de uso (fechas y página) están en
 * `domain/shared/error-codes.ts`, y `USER_REQUIRED` ya lo lanza la lectura de `X-User`.
 * Se lanzan con `new BusinessError(PERIOD_TOO_LARGE.code, PERIOD_TOO_LARGE.message)`, salvo
 * `TOO_MANY_REQUESTS` (ver su comentario).
 */

/** Periodo de más de un año, o más de `SIRE_MAX_RECORDS` líneas. */
export const PERIOD_TOO_LARGE = {
  code: 'PERIOD_TOO_LARGE',
  message:
    'El periodo solicitado excede el límite permitido. Por favor exporte periodos más cortos.',
} as const;

/** El periodo no tiene movimientos de extranjeros: no se genera archivo ni `SireExport`. */
export const NO_MIGRATORY_MOVEMENTS = {
  code: 'NO_MIGRATORY_MOVEMENTS',
  message: 'No hay movimientos migratorios que reportar en ese periodo.',
} as const;

/** Un dato del huésped no se puede codificar en el archivo. */
export const INVALID_GUEST_CHARACTERS = {
  code: 'INVALID_GUEST_CHARACTERS',
  message: 'Caracteres no válidos en el registro del huésped.',
} as const;

/** `exportKind` distinto de `PERIOD` o `SINGLE_MOVEMENT`. */
export const INVALID_EXPORT_KIND = {
  code: 'INVALID_EXPORT_KIND',
  message: 'El tipo de exportación no es válido.',
} as const;

/** El `movementId` no existe, es de un colombiano o tiene formato inválido. */
export const MOVEMENT_NOT_FOUND = {
  code: 'MOVEMENT_NOT_FOUND',
  message: 'El movimiento no existe.',
} as const;

/**
 * Se superó el límite de solicitudes de exportación. Es el único **429** del Módulo 2: no se lanza como
 * `BusinessError` (que sale como 400), sino desde `SireRateLimiter`, que agrega la cabecera `Retry-After`.
 */
export const TOO_MANY_REQUESTS = {
  code: 'TOO_MANY_REQUESTS',
  message:
    'Se superó el límite de solicitudes de exportación. Intente de nuevo en unos segundos.',
} as const;
