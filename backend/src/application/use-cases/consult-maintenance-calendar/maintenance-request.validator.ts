/** UUID en su forma estándar `8-4-4-4-12` (hexadecimal), de cualquier versión: el plan no fija una. */
const UUID_FORMAT =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

/** El `roomId` es un UUID. */
export function isValidRoomId(roomId: string): boolean {
  return UUID_FORMAT.test(roomId);
}

/**
 * Las dos fechas son `AAAA-MM-DD` reales y la salida (`endDate`) es posterior a la llegada
 * (`startDate`). En `AAAA-MM-DD`, el orden del texto es el de las fechas.
 */
export function isValidStayDates(startDate: string, endDate: string): boolean {
  return isRealDate(startDate) && isRealDate(endDate) && endDate > startDate;
}

/**
 * La fecha existe en el calendario: si no existe (por ejemplo `2026-02-30`), `Date` la corre al mes
 * siguiente y deja de coincidir. Se lee en UTC para que no dependa de la zona horaria del computador.
 */
function isRealDate(value: string): boolean {
  if (!DATE_FORMAT.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}
