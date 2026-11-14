import { randomUUID } from 'node:crypto';
import { NIGHTLY_RATES_IN_CENTS, QUOTE_CURRENCY } from './data.js';
import { addDays, isRealDate } from './dates.js';
import { errorReply, reply } from './http.js';

/** Las noches más largas que se cotizan: protege al simulador de un rango enorme. */
const MAX_NIGHTS = 366;

/**
 * El Módulo 3 simulado: la cotización de una habitación (`calculate-dynamic-rate`, A1). Da una tarifa
 * fija por categoría y por noche, con un `quoteId` nuevo en cada respuesta, y los errores que nombra ese
 * plan: `400` `INVALID_QUERY_PARAMS` o `INVALID_DATE_RANGE` y `404` `BASE_RATE_NOT_FOUND`.
 * @returns {import('./http.js').Handler}
 */
export function module3Handler() {
  return ({ method, url, body }) => {
    if (method !== 'POST' || url.pathname !== '/pricing/quotes') {
      return errorReply(404, 'NOT_FOUND', 'Ruta no encontrada.');
    }
    const request = parse(body);
    if (
      request === null ||
      typeof request.roomType !== 'string' ||
      !isRealDate(request.checkInDate) ||
      !isRealDate(request.checkOutDate)
    ) {
      return errorReply(
        400,
        'INVALID_QUERY_PARAMS',
        'Faltan datos o tienen otro formato.',
      );
    }
    const { roomType, checkInDate, checkOutDate } = request;
    const nights = nightsBetween(checkInDate, checkOutDate);
    if (nights.length === 0 || nights.length > MAX_NIGHTS) {
      return errorReply(
        400,
        'INVALID_DATE_RANGE',
        'El rango de fechas es inválido.',
      );
    }
    const rate = NIGHTLY_RATES_IN_CENTS.get(roomType);
    if (rate === undefined) {
      return errorReply(
        404,
        'BASE_RATE_NOT_FOUND',
        'No hay tarifa base para esa categoría.',
      );
    }
    return reply(200, {
      quoteId: randomUUID(),
      currency: QUOTE_CURRENCY,
      nightlyRates: nights.map((date) => ({ date, rate: toAmount(rate) })),
      lodgingAmount: toAmount(rate * nights.length),
    });
  };
}

/**
 * @param {string} body
 * @returns {Record<string, unknown> | null}
 */
function parse(body) {
  try {
    const value = JSON.parse(body);
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? value
      : null;
  } catch {
    return null;
  }
}

/**
 * Las noches de la estadía: de la llegada hasta el día anterior a la salida. Vacío si la salida no es
 * posterior a la llegada.
 * @param {string} checkInDate
 * @param {string} checkOutDate
 */
function nightsBetween(checkInDate, checkOutDate) {
  const nights = [];
  for (
    let date = checkInDate;
    date < checkOutDate && nights.length <= MAX_NIGHTS;
    date = addDays(date, 1)
  ) {
    nights.push(date);
  }
  return nights;
}

/**
 * Centavos como importe de texto con dos decimales (`22000000` → `"220000.00"`), sin pasar por decimales
 * de `number`.
 * @param {number} cents
 */
function toAmount(cents) {
  return `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}
