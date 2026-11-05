/** Una fecha `AAAA-MM-DD` real (no `2026-02-30`). */
const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

/** La zona horaria del hotel (plan base): "hoy" es el día en Colombia. */
const HOTEL_TIME_ZONE = 'America/Bogota';

/**
 * @param {unknown} value
 * @returns {value is string}
 */
export function isRealDate(value) {
  if (typeof value !== 'string' || !DATE_FORMAT.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

/**
 * El día de hoy en el hotel, como `AAAA-MM-DD`.
 * @param {Date} [now]
 */
export function todayInHotel(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: HOTEL_TIME_ZONE }).format(
    now,
  );
}

/**
 * La fecha `days` días después (o antes, si es negativo).
 * @param {string} date `AAAA-MM-DD`
 * @param {number} days
 */
export function addDays(date, days) {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}
