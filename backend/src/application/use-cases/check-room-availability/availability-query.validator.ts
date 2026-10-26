/**
 * Validador de la consulta de disponibilidad. No revisa el formato del `roomId` ni de la `categoryRoom`:
 * eso lo hacen los validadores de `consult-room-inventory` (tarea #42) antes de consultar el inventario.
 */

const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

/** `RSV-` y 8 caracteres hexadecimales en mayúscula (plan base). */
const RESERVATION_REF_FORMAT = /^RSV-[0-9A-F]{8}$/;

/**
 * Las dos fechas son `AAAA-MM-DD` reales y la salida (`endDate`) es posterior a la llegada
 * (`startDate`). En `AAAA-MM-DD`, el orden del texto es el de las fechas.
 */
export function isValidStayDates(startDate: string, endDate: string): boolean {
  return isRealDate(startDate) && isRealDate(endDate) && endDate > startDate;
}

/**
 * Viene exactamente uno de los dos: la categoría o el `roomId`. Un campo cuenta si viene, aunque esté
 * vacío.
 */
export function hasExactlyCategoryOrRoomId(
  categoryRoom: string | undefined,
  roomId: string | undefined,
): boolean {
  return (categoryRoom !== undefined) !== (roomId !== undefined);
}

/**
 * La referencia de la reserva que se modifica tiene el formato del plan base. Es opcional: si no viene,
 * no hay nada que revisar. Si esa reserva existe, no se revisa aquí.
 */
export function isValidExcludeReservationRef(
  excludeReservationRef: string | undefined,
): boolean {
  return (
    excludeReservationRef === undefined ||
    RESERVATION_REF_FORMAT.test(excludeReservationRef)
  );
}

/**
 * La fecha existe en el calendario: con un día o un mes fuera de rango (por ejemplo `2026-13-01`),
 * `Date` no la puede crear; con un día que ese mes no tiene (por ejemplo `2026-02-30`), la corre al mes
 * siguiente y deja de coincidir. Se lee en UTC para que no dependa de la zona horaria del computador.
 */
function isRealDate(value: string): boolean {
  if (!DATE_FORMAT.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}
