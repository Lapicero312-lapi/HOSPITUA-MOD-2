import { randomUUID } from 'node:crypto';
import { isRealDate } from './dates.js';

/**
 * Los avisos de Check-In y Check-Out que el Módulo 1 publica en RabbitMQ (plan de `update-reservation`, A;
 * plan base, "Simuladores del Módulo 1 y del Módulo 3"). Aquí solo se arman y se revisan: publicarlos es de
 * `module1-messaging.js`.
 */

/** El exchange compartido por los módulos (plan base) y la routing key de cada aviso. */
export const EVENTS_EXCHANGE = 'hospitua.events';
export const ROUTING_KEYS = {
  'check-in': 'habitacion.checkin',
  'check-out': 'habitacion.checkout',
};

/** La cola que el Módulo 2 llena con la lista del día y sus actualizaciones, y sus dos routing keys. */
export const DAILY_LIST_QUEUE = 'm1.reservas.diarias.queue';
export const DAILY_LIST_ROUTING_KEYS = [
  'reserva.lista-del-dia',
  'reserva.lista-del-dia.actualizacion',
];

const MOVEMENT_TYPES = { 'check-in': 'ENTRY', 'check-out': 'DEPARTURE' };

/** `RSV-` y 8 caracteres hexadecimales en mayúscula (plan base). */
const RESERVATION_REF_FORMAT = /^RSV-[0-9A-F]{8}$/;
const UUID_FORMAT =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * @typedef {'check-in' | 'check-out'} Movement
 * @typedef {{ reservationRef: string; roomId: string; guests: object[]; movementDate?: string }} MovementRequest
 */

/**
 * Revisa lo que llega a `POST /simulate/check-in` o `/simulate/check-out`.
 * @param {unknown} body el cuerpo ya leído como JSON
 * @returns {{ ok: true; request: MovementRequest } | { ok: false; message: string }}
 */
export function readMovementRequest(body) {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, message: 'El cuerpo debe ser un objeto JSON.' };
  }
  const { reservationRef, roomId, guests, movementDate } =
    /** @type {Record<string, unknown>} */ (body);
  if (
    typeof reservationRef !== 'string' ||
    !RESERVATION_REF_FORMAT.test(reservationRef)
  ) {
    return {
      ok: false,
      message: 'reservationRef debe ser RSV- y 8 hexadecimales en mayúscula.',
    };
  }
  if (typeof roomId !== 'string' || !UUID_FORMAT.test(roomId)) {
    return { ok: false, message: 'roomId debe ser un UUID.' };
  }
  if (!Array.isArray(guests) || guests.length === 0) {
    return { ok: false, message: 'guests debe traer al menos un huésped.' };
  }
  if (movementDate !== undefined && !isRealDate(movementDate)) {
    return {
      ok: false,
      message: 'movementDate debe ser una fecha AAAA-MM-DD.',
    };
  }
  return {
    ok: true,
    request: {
      reservationRef,
      roomId,
      guests,
      ...(movementDate === undefined ? {} : { movementDate }),
    },
  };
}

/**
 * El mensaje del contrato A: `movementType` y `movementDate` a nivel de mensaje, para todos los huéspedes.
 * Los huéspedes van tal como llegaron: el simulador no los corrige, así se puede probar también lo que el
 * Módulo 2 rechaza.
 * @param {Movement} movement
 * @param {MovementRequest} request
 * @param {{ sequenceNumber: number; today: string; messageId?: string }} context
 */
export function movementMessage(movement, request, context) {
  return {
    messageId: context.messageId ?? randomUUID(),
    sequenceNumber: context.sequenceNumber,
    reservationRef: request.reservationRef,
    roomId: request.roomId,
    movementType: MOVEMENT_TYPES[movement],
    movementDate: request.movementDate ?? context.today,
    guests: request.guests,
  };
}

/**
 * El `sequenceNumber` de cada cola: creciente y nunca se reinicia (FR-023 de `update-reservation`). Empieza
 * en los segundos desde 1970, así un simulador reiniciado sigue por encima del anterior.
 * @param {() => number} [nowMs]
 */
export function sequenceCounter(nowMs = () => Date.now()) {
  /** @type {Record<Movement, number>} */
  const last = {
    'check-in': Math.floor(nowMs() / 1000),
    'check-out': Math.floor(nowMs() / 1000),
  };
  return {
    /** @param {Movement} movement */
    next(movement) {
      last[movement] += 1;
      return last[movement];
    },
  };
}

/**
 * Una línea de log para un mensaje de la lista del día, sin datos de los huéspedes: el tipo, la secuencia,
 * la fecha y, según el caso, los totales o la reserva y su cambio.
 * @param {string} routingKey
 * @param {Record<string, unknown>} payload
 */
export function describeDailyListMessage(routingKey, payload) {
  const head = `secuencia ${String(payload.sequenceNumber)} del ${String(payload.operationalDate)}`;
  if (routingKey === 'reserva.lista-del-dia') {
    return `Lista del día recibida (${head}): ${String(payload.totalReservations)} reservas, ${String(payload.totalRooms)} habitaciones y ${String(payload.totalGuests)} huéspedes.`;
  }
  const reason =
    payload.removalReason === undefined || payload.removalReason === null
      ? ''
      : ` (${String(payload.removalReason)})`;
  return `Actualización ${String(payload.updateType)}${reason} de ${String(payload.reservationRef)} recibida (${head}).`;
}
