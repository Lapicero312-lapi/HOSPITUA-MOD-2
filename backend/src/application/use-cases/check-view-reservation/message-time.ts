/**
 * Las horas de los mensajes al Módulo 1, en hora de Colombia (plan de `check-view-reservation`, "Anotar
 * un cambio"). Colombia no tiene horario de verano: siempre es `-05:00`.
 */
const COLOMBIA_OFFSET_MINUTES = -5 * 60;
const COLOMBIA_OFFSET = '-05:00';

/**
 * Una fecha con hora y zona, como la entrega la base (`2026-10-08 15:42:10.123456-05`) o en ISO 8601
 * (`2026-10-08T15:42:10.123456-05:00`, `…Z`). Los decimales son opcionales: la base no escribe los ceros
 * del final.
 */
const TIMESTAMP_TEXT =
  /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|([+-])(\d{2})(?::?(\d{2}))?)$/;

/** `occurredAt` y `generatedAt`: el instante en hora de Colombia, con segundos (`2026-10-09T09:15:00-05:00`). */
export function colombiaTime(instant: Date): string {
  return `${colombiaClock(instant.getTime())}${COLOMBIA_OFFSET}`;
}

/**
 * `updatedAt`: la versión de la reserva en hora de Colombia, con sus seis decimales
 * (`2026-10-09T09:15:00.000000-05:00`). Se trabaja sobre el texto para no perder los microsegundos, que
 * `Date` no guarda.
 * @throws Error si el texto no es una fecha con hora y zona: es un error del programa.
 */
export function colombiaTimeWithMicroseconds(timestamp: string): string {
  const match = TIMESTAMP_TEXT.exec(timestamp);
  if (match === null) {
    throw new Error(`"${timestamp}" no es una fecha con hora y zona.`);
  }
  const [, year, month, day, hour, minute, second, fraction = ''] = match;
  const [zone, sign, offsetHours, offsetMinutes = '00'] = match.slice(8);
  const offset =
    zone === 'Z'
      ? 0
      : (sign === '-' ? -1 : 1) *
        (Number(offsetHours) * 60 + Number(offsetMinutes));
  const utc =
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    ) -
    offset * 60_000;
  return `${colombiaClock(utc)}.${fraction.padEnd(6, '0')}${COLOMBIA_OFFSET}`;
}

/** La fecha y la hora de Colombia de un instante en milisegundos UTC, hasta los segundos. */
function colombiaClock(utcMillis: number): string {
  const local = new Date(utcMillis + COLOMBIA_OFFSET_MINUTES * 60_000);
  const two = (value: number) => String(value).padStart(2, '0');
  return (
    `${local.getUTCFullYear()}-${two(local.getUTCMonth() + 1)}-${two(local.getUTCDate())}` +
    `T${two(local.getUTCHours())}:${two(local.getUTCMinutes())}:${two(local.getUTCSeconds())}`
  );
}
