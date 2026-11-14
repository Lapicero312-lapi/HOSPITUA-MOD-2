/**
 * Una fecha con hora y zona, como la entrega la base (`2026-10-08 15:42:10.123456-05`) o en ISO 8601
 * (`2026-10-08T15:42:10.123456-05:00`, `…Z`). Los decimales son opcionales: la base no escribe los ceros
 * del final.
 */
const TIMESTAMP_TEXT =
  /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|([+-])(\d{2})(?::?(\d{2}))?)$/;

/**
 * Si dos `updatedAt` son el mismo instante, con sus microsegundos (plan de `cancel-reservation`, punto 10,
 * paso 4). Se comparan como instantes y no como texto porque la base y la pantalla los escriben distinto.
 * Un texto que no es una fecha con hora y zona no coincide con ninguno.
 */
export function isSameInstant(left: string, right: string): boolean {
  const leftMicros = toEpochMicroseconds(left);
  return leftMicros !== null && leftMicros === toEpochMicroseconds(right);
}

/** Los microsegundos desde 1970 en UTC, o `null` si el texto no es una fecha con hora y zona. */
function toEpochMicroseconds(timestamp: string): bigint | null {
  const match = TIMESTAMP_TEXT.exec(timestamp);
  if (match === null) {
    return null;
  }
  const [, year, month, day, hour, minute, second, fraction = ''] = match;
  const [zone, sign, offsetHours, offsetMinutes = '00'] = match.slice(8);
  const offsetMinutesTotal =
    zone === 'Z'
      ? 0
      : (sign === '-' ? -1 : 1) *
        (Number(offsetHours) * 60 + Number(offsetMinutes));
  const utcMillis =
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    ) -
    offsetMinutesTotal * 60_000;
  return BigInt(utcMillis) * 1_000n + BigInt(fraction.padEnd(6, '0'));
}
