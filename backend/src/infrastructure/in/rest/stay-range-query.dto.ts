import { UNSUPPORTED_PARAMETER } from '../../../application/use-cases/check-view-reservation/error-codes.js';
import type {
  StayRangeQuery,
  StayRangeReservation,
} from '../../../application/use-cases/check-view-reservation/ports/in/find-reservations-by-stay-range.port.js';
import { BusinessError } from '../../../domain/shared/business-error.js';
import {
  INCOMPLETE_DATE_RANGE,
  INVALID_DATE,
  INVALID_ROOM_ID,
} from '../../../domain/shared/error-codes.js';
import {
  isRealDate,
  readStayRange,
  UUID_FORMAT,
} from './reservation-list-query.dto.js';

/** Los únicos parámetros de la consulta del Módulo 1 (C5). */
const SUPPORTED_PARAMETERS = ['dateFrom', 'dateTo', 'roomId'];

/** La respuesta de `GET /api/reservations` con `X-Client: MODULE1` (C5): sin paginar. */
export type StayRangeBody = { items: StayRangeReservation[] };

/**
 * Revisa los parámetros de la consulta del Módulo 1 antes de consultar, en el orden del plan ("Consulta
 * del Módulo 1"); el primero que falla responde:
 * 1. un parámetro que no es `dateFrom`, `dateTo` ni `roomId` (el primero en orden alfabético);
 * 2. falta una de las dos fechas, o las dos;
 * 3. las fechas, con las reglas de C1: formato, orden y 366 días;
 * 4. `roomId` que no es un UUID.
 *
 * Un parámetro repetido llega como lista y cuenta como valor no válido de ese parámetro.
 * @throws BusinessError `UNSUPPORTED_PARAMETER`, `INCOMPLETE_DATE_RANGE`, `INVALID_DATE`,
 * `INVALID_DATE_RANGE`, `DATE_RANGE_TOO_LARGE` o `INVALID_ROOM_ID`.
 */
export function readStayRangeQuery(
  query: Record<string, unknown>,
): StayRangeQuery {
  const [unsupported] = Object.keys(query)
    .filter((name) => !SUPPORTED_PARAMETERS.includes(name))
    .sort();
  if (unsupported !== undefined) {
    throw new BusinessError(
      UNSUPPORTED_PARAMETER.code,
      UNSUPPORTED_PARAMETER.message(unsupported),
    );
  }

  const { dateFrom, dateTo, roomId } = query;
  if (dateFrom === undefined || dateTo === undefined) {
    throw new BusinessError(
      INCOMPLETE_DATE_RANGE.code,
      INCOMPLETE_DATE_RANGE.message,
    );
  }
  if (!isRealDate(dateFrom) || !isRealDate(dateTo)) {
    throw new BusinessError(INVALID_DATE.code, INVALID_DATE.message);
  }
  // Ya vienen las dos: `readStayRange` revisa el orden y los 366 días con los mensajes de C1.
  const stayRange = readStayRange(dateFrom, dateTo);
  if (stayRange === null) {
    throw new Error('El rango de la consulta del Módulo 1 no puede faltar.');
  }

  if (
    roomId !== undefined &&
    (typeof roomId !== 'string' || !UUID_FORMAT.test(roomId))
  ) {
    throw new BusinessError(INVALID_ROOM_ID.code, INVALID_ROOM_ID.message);
  }
  return { ...stayRange, roomId: roomId ?? null };
}

/** Convierte las reservas en el JSON de C5; de cada una salen solo los campos del contrato. */
export function toStayRangeBody(
  reservations: StayRangeReservation[],
): StayRangeBody {
  return {
    items: reservations.map(
      ({ reservationRef, status, startDate, endDate, rooms }) => ({
        reservationRef,
        status,
        startDate,
        endDate,
        rooms: rooms.map(({ roomId, roomNumber, categoryRoom }) => ({
          roomId,
          roomNumber,
          categoryRoom,
        })),
      }),
    ),
  };
}
