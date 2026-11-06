import { BusinessError } from '../shared/business-error.js';
import {
  GUEST_COUNT_EXCEEDS_CAPACITY,
  GUEST_COUNT_TOO_LOW,
  INVALID_RESERVATION_DATES,
  INVALID_ROOM_COUNT,
  LAST_ROOM_CANNOT_BE_REMOVED,
  NOTES_TOO_LONG,
  ROOM_ALREADY_IN_RESERVATION,
  START_DATE_IN_PAST,
} from '../shared/error-codes.js';

const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ROOMS = 10;
const MAX_NOTES_LENGTH = 500;

/**
 * Las reglas de una reserva al modificarla (plan de `update-reservation`, regla 3 y punto 12). Cada función
 * es un paso: el flujo las llama en el orden de la regla 3, porque entre ellas consulta el inventario (la
 * capacidad de cada habitación la da el Módulo 1). La primera que falla responde.
 */

/**
 * Paso 3: la entrada no es anterior al día operativo (`AAAA-MM-DD`, del `Clock`) y la salida es posterior.
 * @throws BusinessError `INVALID_RESERVATION_DATES` si una fecha está vacía o no existe, o si la salida no
 * es posterior a la entrada; `START_DATE_IN_PAST` si la entrada es anterior al día operativo.
 */
export function checkStayDates(
  startDate: string,
  endDate: string,
  operationalDate: string,
): void {
  if (!isRealDate(startDate) || !isRealDate(endDate)) {
    throw new BusinessError(
      INVALID_RESERVATION_DATES.code,
      INVALID_RESERVATION_DATES.message,
    );
  }
  // En `AAAA-MM-DD`, el orden del texto es el de las fechas.
  if (startDate < operationalDate) {
    throw new BusinessError(
      START_DATE_IN_PAST.code,
      START_DATE_IN_PAST.message,
    );
  }
  if (endDate <= startDate) {
    throw new BusinessError(
      INVALID_RESERVATION_DATES.code,
      INVALID_RESERVATION_DATES.message,
    );
  }
}

/**
 * Paso 4, sin el inventario: la lista completa de habitaciones que quedan en la reserva.
 * @throws BusinessError `LAST_ROOM_CANNOT_BE_REMOVED` si queda vacía, `INVALID_ROOM_COUNT` si son más de
 * 10, o `ROOM_ALREADY_IN_RESERVATION` si se repite un `roomId`.
 */
export function checkRoomList(roomIds: readonly string[]): void {
  if (roomIds.length === 0) {
    throw new BusinessError(
      LAST_ROOM_CANNOT_BE_REMOVED.code,
      LAST_ROOM_CANNOT_BE_REMOVED.message,
    );
  }
  if (roomIds.length > MAX_ROOMS) {
    throw new BusinessError(
      INVALID_ROOM_COUNT.code,
      INVALID_ROOM_COUNT.message,
    );
  }
  if (new Set(roomIds).size !== roomIds.length) {
    throw new BusinessError(
      ROOM_ALREADY_IN_RESERVATION.code,
      ROOM_ALREADY_IN_RESERVATION.message,
    );
  }
}

/**
 * Paso 5: cada habitación tiene al menos una persona y no más que su `maxCapacity`. Se revisan en el orden
 * en que llegan, y en cada una primero el mínimo.
 * @throws BusinessError `GUEST_COUNT_TOO_LOW` o `GUEST_COUNT_EXCEEDS_CAPACITY`.
 */
export function checkGuestCounts(
  rooms: readonly { guestCount: number; maxCapacity: number }[],
): void {
  for (const { guestCount, maxCapacity } of rooms) {
    if (guestCount < 1) {
      throw new BusinessError(
        GUEST_COUNT_TOO_LOW.code,
        GUEST_COUNT_TOO_LOW.message,
      );
    }
    if (guestCount > maxCapacity) {
      throw new BusinessError(
        GUEST_COUNT_EXCEEDS_CAPACITY.code,
        GUEST_COUNT_EXCEEDS_CAPACITY.message,
      );
    }
  }
}

/**
 * Paso 6, la longitud de `notes` (los caracteres válidos los revisa el validador del cambio).
 * @throws BusinessError `NOTES_TOO_LONG` si pasa de 500 caracteres.
 */
export function checkNotes(notes: string | null): void {
  if (notes !== null && notes.length > MAX_NOTES_LENGTH) {
    throw new BusinessError(NOTES_TOO_LONG.code, NOTES_TOO_LONG.message);
  }
}

/**
 * La fecha existe en el calendario: con un día que ese mes no tiene (por ejemplo `2026-02-30`), `Date` la
 * corre al mes siguiente y deja de coincidir. Se lee en UTC para que no dependa de la zona del computador.
 */
function isRealDate(value: string): boolean {
  if (!DATE_FORMAT.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}
