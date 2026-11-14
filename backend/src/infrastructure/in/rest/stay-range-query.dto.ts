import { ApiProperty } from '@nestjs/swagger';
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

/*
 * La respuesta de C5 como clases, para que OpenAPI la describa (plan, "OpenAPI (T037) y pruebas de contrato
 * (T034)").
 */

/** Una habitación de la reserva en C5: todas las de la reserva, aunque se filtre por `roomId`. */
export class StayRangeRoomDto {
  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: '`null` en una habitación de Booking sin asignar.',
    example: 'a4c2e6f8-1b3d-4e5f-8a7b-9c0d1e2f3a4b',
  })
  roomId: string | null;

  @ApiProperty({ type: String, nullable: true, example: '204' })
  roomNumber: string | null;

  @ApiProperty({ example: 'DOBLE' })
  categoryRoom: string;
}

/** Una reserva vigente en C5, sin datos financieros ni del huésped. */
export class StayRangeReservationDto {
  @ApiProperty({ pattern: '^RSV-[0-9A-F]{8}$', example: 'RSV-3F9A1C7B' })
  reservationRef: string;

  @ApiProperty({
    enum: ['PENDING', 'ACTIVE', 'IN_PROGRESS'],
    example: 'ACTIVE',
  })
  status: StayRangeReservation['status'];

  @ApiProperty({ format: 'date', example: '2026-10-23' })
  startDate: string;

  @ApiProperty({ format: 'date', example: '2026-10-25' })
  endDate: string;

  @ApiProperty({ type: [StayRangeRoomDto] })
  rooms: StayRangeRoomDto[];
}

/** La respuesta de `GET /api/reservations` con `X-Client: MODULE1` (C5): sin paginar. */
export class StayRangeDto {
  @ApiProperty({
    type: [StayRangeReservationDto],
    description:
      'Las reservas `PENDING`, `ACTIVE` o `IN_PROGRESS` cuya estadía se cruza con el rango, de la llegada más antigua a la más reciente.',
  })
  items: StayRangeReservationDto[];
}

/** La respuesta de C5: la misma clase. */
export type StayRangeBody = StayRangeDto;

/** El ejemplo de C5 del plan (el `roomId` "a4c2…" del plan, completo). */
export const STAY_RANGE_EXAMPLE: StayRangeBody = {
  items: [
    {
      reservationRef: 'RSV-3F9A1C7B',
      status: 'ACTIVE',
      startDate: '2026-10-23',
      endDate: '2026-10-25',
      rooms: [
        {
          roomId: 'a4c2e6f8-1b3d-4e5f-8a7b-9c0d1e2f3a4b',
          roomNumber: '204',
          categoryRoom: 'DOBLE',
        },
      ],
    },
  ],
};

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
