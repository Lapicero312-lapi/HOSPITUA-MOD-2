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

/**
 * Un dato del huésped no se puede codificar en el archivo SIRE, o contiene el separador o un salto de línea
 * (plan de `export-sire-file`, punto 12). Lo lanza `formatSireLine`.
 */
export const INVALID_GUEST_CHARACTERS = {
  code: 'INVALID_GUEST_CHARACTERS',
  message: 'Caracteres no válidos en el registro del huésped.',
} as const;

/** La fecha de entrada es anterior al día operativo en curso. */
export const START_DATE_IN_PAST = {
  code: 'START_DATE_IN_PAST',
  message: 'La fecha de entrada no puede ser anterior a hoy.',
} as const;

/** Fechas vacías o inexistentes, o salida no posterior a la entrada. Lo lanza `Reservation`. */
export const INVALID_RESERVATION_DATES = {
  code: 'INVALID_RESERVATION_DATES',
  message: 'La fecha de salida debe ser posterior a la de entrada.',
} as const;

/** Menos de 1 o más de 10 habitaciones. Lo lanza `Reservation`. */
export const INVALID_ROOM_COUNT = {
  code: 'INVALID_ROOM_COUNT',
  message: 'Una reserva debe tener entre 1 y 10 habitaciones.',
} as const;

/** El cambio dejaría la reserva sin habitaciones (plan de `update-reservation`, punto 12). */
export const LAST_ROOM_CANNOT_BE_REMOVED = {
  code: 'LAST_ROOM_CANNOT_BE_REMOVED',
  message: 'La reserva debe conservar al menos una habitación.',
} as const;

/** La misma habitación dos veces. Lo lanza `Reservation`. */
export const ROOM_ALREADY_IN_RESERVATION = {
  code: 'ROOM_ALREADY_IN_RESERVATION',
  message: 'La habitación ya forma parte de la reserva.',
} as const;

/** Una habitación con menos de una persona. Lo lanza `ReservationRoom`. */
export const GUEST_COUNT_TOO_LOW = {
  code: 'GUEST_COUNT_TOO_LOW',
  message: 'Cada habitación debe tener al menos una persona.',
} as const;

/** `notes` de más de 500 caracteres. Lo lanza `Reservation`. */
export const NOTES_TOO_LONG = {
  code: 'NOTES_TOO_LONG',
  message: 'Las observaciones no pueden superar 500 caracteres.',
} as const;

/** `documentType` no es `RC`, `TI`, `CC`, `CE`, `PAS` ni `NIT`. Lo usan la creación y la modificación de la reserva. */
export const INVALID_DOCUMENT_TYPE = {
  code: 'INVALID_DOCUMENT_TYPE',
  message: 'El tipo de documento no es válido.',
} as const;

/**
 * `guestCount` de una habitación no es un número entero (en la creación, tampoco uno negativo; el `0` es
 * `GUEST_COUNT_TOO_LOW`). Lo usan `generate-direct-reservation` y `update-reservation`.
 */
export const INVALID_GUEST_COUNT = {
  code: 'INVALID_GUEST_COUNT',
  message: 'La cantidad de personas debe ser un número entero mayor que cero.',
} as const;

/** `contactEmail` del titular con formato inválido. Lo usan la creación y la modificación de la reserva. */
export const INVALID_EMAIL = {
  code: 'INVALID_EMAIL',
  message: 'El correo electrónico no es válido.',
} as const;

/** El `guestCount` de una habitación es mayor que su `maxCapacity`. */
export const GUEST_COUNT_EXCEEDS_CAPACITY = {
  code: 'GUEST_COUNT_EXCEEDS_CAPACITY',
  message: 'La cantidad de personas supera la capacidad de la habitación.',
} as const;

/**
 * Una habitación concreta no está disponible. Su mensaje lleva el número de la habitación (plan base, regla
 * 5: "puede llevar datos, como `{roomNumber}`"), así que es una función: se lanza con
 * `new BusinessError(ROOM_NOT_AVAILABLE.code, ROOM_NOT_AVAILABLE.message('201'))`.
 */
export const ROOM_NOT_AVAILABLE = {
  code: 'ROOM_NOT_AVAILABLE',
  message: (roomNumber: string) =>
    `La habitación ${roomNumber} no está disponible para el rango de fechas solicitado.`,
} as const;

/** Falta un dato obligatorio del titular, o su tipo y su número de documento no van juntos. */
export const GUEST_DATA_REQUIRED = {
  code: 'GUEST_DATA_REQUIRED',
  message: 'Los datos del titular son obligatorios.',
} as const;

/**
 * Otro cambio de la reserva ganó: su `updatedAt` ya no es el que se leyó (plan base, control de
 * concurrencia). Lo lanzan el repositorio de reservas y `cancel-reservation` (regla 3, paso 4).
 */
export const CONCURRENT_UPDATE = {
  code: 'CONCURRENT_UPDATE',
  message: 'Esta reserva ya fue actualizada o cancelada recientemente',
} as const;
