/**
 * Códigos de error que solo usa `cancel-reservation`, con los mensajes literales de la tabla C de su plan
 * (los del spec cuando existen). Los que comparte con otros casos de uso están en
 * `domain/shared/error-codes.ts`; `CONCURRENT_UPDATE` y `USER_REQUIRED` ya los lanzan el repositorio de
 * reservas y la lectura de `X-User`.
 * Se lanzan con `new BusinessError(STATUS_NOT_CANCELLABLE.code, STATUS_NOT_CANCELLABLE.message)`.
 */

/** La referencia viene vacía, solo con espacios o nula. */
export const RESERVATION_REF_REQUIRED = {
  code: 'RESERVATION_REF_REQUIRED',
  message: 'La referencia de la reserva es obligatoria.',
} as const;

/** La Recepcionista intenta cancelar una reserva de OTA. */
export const OTA_RESERVATION_CANCEL_VIA_API = {
  code: 'OTA_RESERVATION_CANCEL_VIA_API',
  message: 'La cancelación de una reserva de OTA debe llegar desde Booking.',
} as const;

/** La reserva está en `IN_PROGRESS`, `COMPLETED`, `CANCELLED` o `NO_SHOW`. */
export const STATUS_NOT_CANCELLABLE = {
  code: 'STATUS_NOT_CANCELLABLE',
  message: 'El estado actual de la reserva no admite cancelación.',
} as const;

/** La Recepcionista no envía `acknowledged: true`. */
export const CANCELLATION_NOT_CONFIRMED = {
  code: 'CANCELLATION_NOT_CONFIRMED',
  message:
    'Debe confirmar que entiende que la cancelación no se puede deshacer.',
} as const;

/** `reason` de más de 500 caracteres. */
export const REASON_TOO_LONG = {
  code: 'REASON_TOO_LONG',
  message: 'El motivo no puede superar 500 caracteres.',
} as const;
