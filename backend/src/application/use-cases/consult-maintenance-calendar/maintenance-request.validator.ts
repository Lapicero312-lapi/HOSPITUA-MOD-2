import { isUUID } from 'class-validator';
import { DateTime } from 'luxon';

/** El `roomId` es un UUID, de cualquier versión: el plan no fija una. */
export function isValidRoomId(roomId: string): boolean {
  return isUUID(roomId);
}

/**
 * Las dos fechas son `AAAA-MM-DD` reales y la salida (`endDate`) es posterior a la llegada
 * (`startDate`).
 */
export function isValidStayDates(startDate: string, endDate: string): boolean {
  const start = toDate(startDate);
  const end = toDate(endDate);
  return start.isValid && end.isValid && end > start;
}

/** Fecha pura, sin hora: se lee en UTC para que no dependa de la zona horaria del computador. */
function toDate(value: string): DateTime {
  return DateTime.fromFormat(value, 'yyyy-MM-dd', { zone: 'utc' });
}
