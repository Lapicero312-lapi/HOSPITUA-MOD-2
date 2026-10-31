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

/** `categoryRoom` vacía o con caracteres no permitidos, o que el Módulo 1 o el Módulo 3 no reconocen. */
export const INVALID_CATEGORY = {
  code: 'INVALID_CATEGORY',
  message: 'La categoría indicada no es válida.',
} as const;

/** El Módulo 3 no responde, falla o responde algo inválido al cotizar una reserva nueva: nunca se asume una tarifa. */
export const PRICING_UNAVAILABLE = {
  code: 'PRICING_UNAVAILABLE',
  message:
    'Error 400: El servicio de cotización de tarifas no se encuentra disponible. Por favor intente más tarde',
} as const;

/** Lo mismo al recotizar una reserva `ACTIVE`: no se aplica ningún cambio y se conservan las tarifas. */
export const RECALCULATION_UNAVAILABLE = {
  code: 'RECALCULATION_UNAVAILABLE',
  message:
    'No se pudo calcular la nueva tarifa en este momento. Intente más tarde.',
} as const;

/** La tarifa cambió entre la vista previa y la confirmación (decisión D1): no se guarda nada. */
export const RATE_CHANGED = {
  code: 'RATE_CHANGED',
  message: 'La tarifa cambió, vuelva a cotizar.',
} as const;

/**
 * El Módulo 1 no responde, falla o responde algo mal formado al consultar el inventario: nunca se asume
 * ninguna habitación.
 */
export const INVENTORY_UNAVAILABLE = {
  code: 'INVENTORY_UNAVAILABLE',
  message:
    'No se pudo consultar el inventario de habitaciones en este momento. Intente de nuevo.',
} as const;

/** Una fecha de un filtro o de un periodo mal formada o inexistente (por ejemplo `2026-02-30`). */
export const INVALID_DATE = {
  code: 'INVALID_DATE',
  message: 'La fecha indicada no es válida.',
} as const;

/** Un rango de fechas con solo una de las dos fechas. */
export const INCOMPLETE_DATE_RANGE = {
  code: 'INCOMPLETE_DATE_RANGE',
  message: 'Debe completar ambas fechas del rango.',
} as const;

/** Un rango de fechas con la fecha inicial posterior a la final. */
export const INVALID_DATE_RANGE = {
  code: 'INVALID_DATE_RANGE',
  message: 'La fecha inicial no puede ser posterior a la fecha final.',
} as const;

/** Un rango de fechas de más de 366 días. */
export const DATE_RANGE_TOO_LARGE = {
  code: 'DATE_RANGE_TOO_LARGE',
  message: 'El rango de fechas no puede superar 366 días.',
} as const;

/** Un filtro por estado de la reserva fuera del enumerado `ReservationStatus`. */
export const INVALID_STATUS = {
  code: 'INVALID_STATUS',
  message: 'El estado indicado no es válido.',
} as const;

/** Una referencia de reserva inválida (cada plan dice cuándo: formato, vacía, caracteres no permitidos…). */
export const INVALID_RESERVATION_CODE = {
  code: 'INVALID_RESERVATION_CODE',
  message: 'Debe proveer un código de reserva válido para la consulta.',
} as const;

/** Un número de página menor que 1 en un listado paginado. */
export const INVALID_PAGE = {
  code: 'INVALID_PAGE',
  message: 'El número de página debe ser 1 o mayor.',
} as const;

/** Una búsqueda por nombre de menos de 3 caracteres (cada plan dice cuándo un texto es un nombre). */
export const NAME_SEARCH_TOO_SHORT = {
  code: 'NAME_SEARCH_TOO_SHORT',
  message: 'La búsqueda por nombre requiere al menos 3 caracteres.',
} as const;

/** La reserva no existe (cada plan dice cuándo: referencia, búsqueda o reserva que se excluye). */
export const RESERVATION_NOT_FOUND = {
  code: 'RESERVATION_NOT_FOUND',
  message: 'La reserva no existe.',
} as const;

/** Caracteres no válidos en un texto libre (cada plan dice cuáles campos: `reason`, `notes`, titular…). */
export const INVALID_CHARACTERS = {
  code: 'INVALID_CHARACTERS',
  message: 'El formato de los datos contiene caracteres no válidos.',
} as const;
