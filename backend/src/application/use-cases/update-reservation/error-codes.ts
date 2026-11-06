/**
 * Códigos de error que solo usa `update-reservation`, con los mensajes literales de las tablas de B de su
 * plan. Los que comparte con otros casos de uso están en `domain/shared/error-codes.ts`, y los que ya lanzan
 * el dominio (`INVALID_STATUS_TRANSITION`, `INVALID_ROOM_COUNT`, `LAST_ROOM_CANNOT_BE_REMOVED`, `NOTES_TOO_LONG`…) y el repositorio de
 * reservas (`CONCURRENT_UPDATE`) se quedan donde están.
 * Se lanzan con `new BusinessError(STATUS_NOT_EDITABLE.code, STATUS_NOT_EDITABLE.message)`.
 */

/** La Recepcionista modifica una reserva `OTA`. */
export const OTA_RESERVATION_READ_ONLY = {
  code: 'OTA_RESERVATION_READ_ONLY',
  message:
    'Las reservas de OTA solo las modifica Booking. Si está en conflicto, solo se le puede asignar la habitación.',
} as const;

/** La reserva está en `IN_PROGRESS`, `COMPLETED`, `CANCELLED` o `NO_SHOW`. */
export const STATUS_NOT_EDITABLE = {
  code: 'STATUS_NOT_EDITABLE',
  message: 'El estado actual de la reserva no admite modificaciones.',
} as const;

/** El cuerpo del cambio trae `guest.nationality`. */
export const NATIONALITY_NOT_EDITABLE = {
  code: 'NATIONALITY_NOT_EDITABLE',
  message: 'La nacionalidad no se puede modificar.',
} as const;

/** B3: la reserva no es de Booking o no está en conflicto. */
export const RESERVATION_NOT_IN_CONFLICT = {
  code: 'RESERVATION_NOT_IN_CONFLICT',
  message:
    'Solo se puede asignar habitación a una reserva de Booking en conflicto.',
} as const;

/** B3: la habitación de la reserva ya tiene número. */
export const ROOM_ALREADY_ASSIGNED = {
  code: 'ROOM_ALREADY_ASSIGNED',
  message: 'Esa habitación de la reserva ya está asignada.',
} as const;

/** B3: la habitación elegida es de otra categoría. */
export const CATEGORY_MISMATCH = {
  code: 'CATEGORY_MISMATCH',
  message: 'La habitación debe ser de la misma categoría.',
} as const;
