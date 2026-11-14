import { ROOMS, maintenancesFrom } from './data.js';
import { isRealDate, todayInHotel } from './dates.js';
import { errorReply, reply } from './http.js';
import {
  ROUTING_KEYS,
  movementMessage,
  readMovementRequest,
  sequenceCounter,
} from './module1-messages.js';

/** UUID en su forma estándar `8-4-4-4-12` (hexadecimal), como lo valida el Módulo 2. */
const UUID_FORMAT =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** La forma acordada de `categoryRoom` (`consult-room-inventory`, A). */
const CATEGORY_ROOM_FORMAT = /^[A-Z0-9_]{1,50}$/;

const ROOM_PATH = /^\/api\/rooms\/([^/]+)$/;
const MAINTENANCES_PATH = /^\/api\/rooms\/([^/]+)\/maintenances$/;
const SIMULATE_PATH = /^\/simulate\/(check-in|check-out)$/;

/**
 * El Módulo 1 simulado: el inventario (`consult-room-inventory`, A1, A2 y A3) y los mantenimientos
 * (`consult-maintenance-calendar`, A1). Con `publisher` (cuando hay `RABBITMQ_URL`), también los avisos de
 * Check-In y Check-Out por RabbitMQ, a pedido: `POST /simulate/check-in` y `POST /simulate/check-out`.
 * @param {{
 *   today?: () => string;
 *   publisher?: import('./module1-messaging.js').Module1Publisher;
 *   sequences?: ReturnType<typeof sequenceCounter>;
 * }} [options] `today` permite fijar el día en las pruebas
 * @returns {import('./http.js').Handler}
 */
export function module1Handler({
  today = () => todayInHotel(),
  publisher,
  sequences = sequenceCounter(),
} = {}) {
  return ({ method, url, body }) => {
    const simulate = SIMULATE_PATH.exec(url.pathname);
    if (simulate && method === 'POST' && publisher) {
      return publishMovement(
        /** @type {'check-in' | 'check-out'} */ (simulate[1]),
        body,
        { publisher, sequences, today: today() },
      );
    }
    if (method !== 'GET') {
      return errorReply(404, 'NOT_FOUND', 'Ruta no encontrada.');
    }
    if (url.pathname === '/api/rooms') {
      return listRooms(url.searchParams.get('categoryRoom'));
    }
    const maintenances = MAINTENANCES_PATH.exec(url.pathname);
    if (maintenances) {
      return checkMaintenances(
        decodeURIComponent(maintenances[1]),
        url.searchParams.get('startDate'),
        url.searchParams.get('endDate'),
        today(),
      );
    }
    const room = ROOM_PATH.exec(url.pathname);
    if (room) {
      return findRoom(decodeURIComponent(room[1]));
    }
    return errorReply(404, 'NOT_FOUND', 'Ruta no encontrada.');
  };
}

/**
 * Arma el aviso del contrato A de `update-reservation` y lo publica. Responde `202` con el mensaje que
 * salió, o `400` si la solicitud no tiene la forma esperada.
 * @param {'check-in' | 'check-out'} movement
 * @param {string} body
 * @param {{
 *   publisher: import('./module1-messaging.js').Module1Publisher;
 *   sequences: ReturnType<typeof sequenceCounter>;
 *   today: string;
 * }} context
 */
async function publishMovement(movement, body, context) {
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return errorReply(400, 'INVALID_BODY', 'El cuerpo debe ser JSON.');
  }
  const read = readMovementRequest(parsed);
  if (!read.ok) {
    return errorReply(400, 'INVALID_BODY', read.message);
  }
  const message = movementMessage(movement, read.request, {
    sequenceNumber: context.sequences.next(movement),
    today: context.today,
  });
  await context.publisher.publish(ROUTING_KEYS[movement], message);
  return reply(202, message);
}

/**
 * A3 sin filtro; A2 con `categoryRoom` (una categoría sin habitaciones da `[]`).
 * @param {string | null} categoryRoom
 */
function listRooms(categoryRoom) {
  if (categoryRoom === null) {
    return reply(200, ROOMS);
  }
  if (!CATEGORY_ROOM_FORMAT.test(categoryRoom)) {
    return errorReply(
      400,
      'INVALID_CATEGORY_ROOM',
      'La categoría tiene un formato inválido.',
    );
  }
  return reply(
    200,
    ROOMS.filter((room) => room.categoryRoom === categoryRoom),
  );
}

/**
 * A1: una habitación por `roomId`.
 * @param {string} roomId
 */
function findRoom(roomId) {
  if (!UUID_FORMAT.test(roomId)) {
    return errorReply(
      400,
      'INVALID_ROOM_ID',
      'El roomId tiene un formato inválido.',
    );
  }
  const room = roomWithId(roomId);
  return room
    ? reply(200, room)
    : errorReply(404, 'ROOM_NOT_FOUND', 'La habitación no existe.');
}

/**
 * La habitación con ese `roomId`, sin distinguir mayúsculas: un UUID es el mismo en mayúsculas o en
 * minúsculas, y el 404 es solo para la habitación que no existe.
 * @param {string} roomId
 */
function roomWithId(roomId) {
  const id = roomId.toLowerCase();
  return ROOMS.find((room) => room.id === id);
}

/**
 * A1 de `consult-maintenance-calendar`: los mantenimientos que se cruzan con la estadía. Hay cruce si el
 * mantenimiento se solapa total o parcialmente con el rango; uno que termina justo antes de la llegada no
 * se cruza. `endDate` es la salida: el huésped no ocupa esa noche.
 * @param {string} roomId
 * @param {string | null} startDate
 * @param {string | null} endDate
 * @param {string} today
 */
function checkMaintenances(roomId, startDate, endDate, today) {
  if (!UUID_FORMAT.test(roomId)) {
    return errorReply(
      400,
      'INVALID_ROOM_ID',
      'El roomId tiene un formato inválido.',
    );
  }
  if (!isRealDate(startDate) || !isRealDate(endDate) || endDate <= startDate) {
    return errorReply(
      400,
      'INVALID_DATE_RANGE',
      'El rango de fechas es inválido.',
    );
  }
  const room = roomWithId(roomId);
  if (!room) {
    return errorReply(404, 'ROOM_NOT_FOUND', 'La habitación no existe.');
  }
  const conflicts = (maintenancesFrom(today).get(room.id) ?? []).filter(
    (maintenance) =>
      maintenance.maintenanceStart < endDate &&
      maintenance.maintenanceEnd >= startDate,
  );
  return reply(200, {
    roomId: room.id,
    available: conflicts.length === 0,
    conflicts,
  });
}
