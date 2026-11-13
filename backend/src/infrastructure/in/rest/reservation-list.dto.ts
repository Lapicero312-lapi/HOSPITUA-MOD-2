import { ApiProperty } from '@nestjs/swagger';
import {
  AGENCY_REQUIRES_OTA_CHANNEL,
  INVALID_CHANNEL,
  INVALID_CONFLICT_FILTER,
  INVALID_OTA_ID,
  INVALID_SORT_ORDER,
  UNSUPPORTED_PARAMETER,
} from '../../../application/use-cases/check-view-reservation/error-codes.js';
import {
  DATE_RANGE_TOO_LARGE,
  INCOMPLETE_DATE_RANGE,
  INVALID_DATE,
  INVALID_DATE_RANGE,
  INVALID_PAGE,
  INVALID_RESERVATION_CODE,
  INVALID_ROOM_ID,
  INVALID_STATUS,
  NAME_SEARCH_TOO_SHORT,
  RESERVATION_NOT_FOUND,
} from '../../../domain/shared/error-codes.js';
import {
  MIGRATION_STATUSES,
  RESERVATION_SOURCES,
  RESERVATION_STATUSES,
} from '../../../domain/shared/enums.js';
import {
  REQUEST_NOT_PROCESSED,
  REQUEST_NOT_PROCESSED_MESSAGE,
} from '../../shared/api-error.js';
import { errorExample, INVALID_CLIENT_EXAMPLE } from './openapi-examples.js';
import { ReservationConflictDto } from './reservation-detail.dto.js';

/*
 * La respuesta de C1 (plan de `check-view-reservation`) como clases, para que OpenAPI la describa (plan,
 * "OpenAPI (T037) y pruebas de contrato (T034)"). El controlador devuelve el `ReservationListResult` del
 * caso de uso, que tiene esta misma forma.
 */

/** El titular en una fila del listado. */
export class ReservationListGuestDto {
  @ApiProperty({ example: 'Valentina Ospina' })
  fullName: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: '`null` en una reserva de Booking que llegó sin documento.',
    example: '1144093552',
  })
  documentNumber: string | null;
}

/** Una habitación en una fila del listado. */
export class ReservationListRoomDto {
  @ApiProperty({
    type: String,
    nullable: true,
    description: '`null` en una habitación sin asignar ("Sin asignar").',
    example: '204',
  })
  roomNumber: string | null;

  @ApiProperty({ example: 'DOBLE' })
  categoryRoom: string;
}

/** Qué botones habilita la pantalla en la fila (FR-005). */
export class ReservationListActionsDto {
  @ApiProperty({
    description: 'Solo en una reserva directa `ACTIVE` o `PENDING`.',
    example: true,
  })
  canModify: boolean;

  @ApiProperty({
    description: 'Solo en una reserva directa `ACTIVE` o `PENDING`.',
    example: true,
  })
  canCancel: boolean;

  @ApiProperty({
    description:
      'Solo en una reserva de Booking en conflicto con alguna habitación sin asignar.',
    example: false,
  })
  canAssignRoom: boolean;
}

/** Una fila del listado: una reserva, con todas sus habitaciones. */
export class ReservationListItemDto {
  @ApiProperty({ pattern: '^RSV-[0-9A-F]{8}$', example: 'RSV-3F9A1C7B' })
  reservationRef: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Solo en reservas `OTA`.',
    example: null,
  })
  externalConfirmationCode: string | null;

  @ApiProperty({ type: ReservationListGuestDto })
  guest: ReservationListGuestDto;

  @ApiProperty({ type: [ReservationListRoomDto] })
  rooms: ReservationListRoomDto[];

  @ApiProperty({ enum: RESERVATION_SOURCES, example: 'DIRECT' })
  source: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'El nombre de la agencia, solo en reservas `OTA`.',
    example: null,
  })
  otaName: string | null;

  @ApiProperty({ format: 'date', example: '2026-10-23' })
  startDate: string;

  @ApiProperty({ format: 'date', example: '2026-10-25' })
  endDate: string;

  @ApiProperty({ enum: RESERVATION_STATUSES, example: 'ACTIVE' })
  status: string;

  @ApiProperty({ enum: MIGRATION_STATUSES, example: 'AWAITING_CHECK_IN' })
  migrationStatus: string;

  @ApiProperty({
    type: ReservationConflictDto,
    nullable: true,
    description: 'Solo en una reserva de Booking en conflicto (FR-002a).',
  })
  conflict: ReservationConflictDto | null;

  @ApiProperty({ type: ReservationListActionsDto })
  actions: ReservationListActionsDto;
}

/** La respuesta de C1: una página de 10. */
export class ReservationListDto {
  @ApiProperty({ type: [ReservationListItemDto] })
  items: ReservationListItemDto[];

  @ApiProperty({
    description:
      'La página que se devolvió: si la pedida supera `totalPages`, la última válida.',
    example: 1,
  })
  page: number;

  @ApiProperty({ description: 'Siempre 10.', example: 10 })
  pageSize: number;

  @ApiProperty({ example: 45 })
  totalItems: number;

  @ApiProperty({ example: 5 })
  totalPages: number;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Sin resultados: "No se encontraron reservas con los filtros aplicados." (FR-010).',
    example: null,
  })
  message: string | null;
}

/** El ejemplo de C1 del plan. */
export const RESERVATION_LIST_EXAMPLE = {
  items: [
    {
      reservationRef: 'RSV-3F9A1C7B',
      externalConfirmationCode: null,
      guest: { fullName: 'Valentina Ospina', documentNumber: '1144093552' },
      rooms: [{ roomNumber: '204', categoryRoom: 'DOBLE' }],
      source: 'DIRECT',
      otaName: null,
      startDate: '2026-10-23',
      endDate: '2026-10-25',
      status: 'ACTIVE',
      migrationStatus: 'AWAITING_CHECK_IN',
      conflict: null,
      actions: { canModify: true, canCancel: true, canAssignRoom: false },
    },
  ],
  page: 1,
  pageSize: 10,
  totalItems: 45,
  totalPages: 5,
  message: null,
};

const LIST_PATH = '/api/reservations';

const listError = (
  summary: string,
  { code, message }: { code: string; message: string },
) => errorExample(LIST_PATH, summary, code, message);

/**
 * Un ejemplo por cada error de `GET /api/reservations`, en el orden en que se revisan: `X-Client`, los de
 * C1 en su orden de validación, `RESERVATION_NOT_FOUND` después de buscar el código, los propios de C5 y la
 * excepción inesperada (plan, "OpenAPI (T037) y pruebas de contrato (T034)").
 */
export const LIST_ERROR_EXAMPLES = {
  INVALID_CLIENT: INVALID_CLIENT_EXAMPLE(LIST_PATH),
  [INVALID_RESERVATION_CODE.code]: listError(
    'Recepcionista: `search` vacío, con caracteres no permitidos o de más de 40',
    INVALID_RESERVATION_CODE,
  ),
  [INVALID_STATUS.code]: listError(
    'Recepcionista: `status` fuera del enumerado',
    INVALID_STATUS,
  ),
  [INVALID_CHANNEL.code]: listError(
    'Recepcionista: `source` fuera del enumerado',
    INVALID_CHANNEL,
  ),
  [INVALID_OTA_ID.code]: listError(
    'Recepcionista: `otaId` que no es un UUID',
    INVALID_OTA_ID,
  ),
  [AGENCY_REQUIRES_OTA_CHANNEL.code]: listError(
    'Recepcionista: `otaId` sin `source=OTA`',
    AGENCY_REQUIRES_OTA_CHANNEL,
  ),
  [INVALID_CONFLICT_FILTER.code]: listError(
    'Recepcionista: `inConflict` distinto de `true`',
    INVALID_CONFLICT_FILTER,
  ),
  [INVALID_DATE.code]: listError(
    'Los dos: `dateFrom` o `dateTo` mal formada o inexistente',
    INVALID_DATE,
  ),
  [INCOMPLETE_DATE_RANGE.code]: listError(
    'Los dos: solo una de las dos fechas (el Módulo 1, también sin ninguna)',
    INCOMPLETE_DATE_RANGE,
  ),
  [INVALID_DATE_RANGE.code]: listError(
    'Los dos: `dateFrom` posterior a `dateTo`',
    INVALID_DATE_RANGE,
  ),
  [DATE_RANGE_TOO_LARGE.code]: listError(
    'Los dos: más de 366 días',
    DATE_RANGE_TOO_LARGE,
  ),
  [INVALID_SORT_ORDER.code]: listError(
    'Recepcionista: `order` distinto de `asc` y `desc`',
    INVALID_SORT_ORDER,
  ),
  [INVALID_PAGE.code]: listError(
    'Recepcionista: `page` menor que 1 o no entero',
    INVALID_PAGE,
  ),
  [NAME_SEARCH_TOO_SHORT.code]: listError(
    'Recepcionista: un nombre de menos de 3 caracteres',
    NAME_SEARCH_TOO_SHORT,
  ),
  [RESERVATION_NOT_FOUND.code]: listError(
    'Recepcionista: `search` empieza con `RSV-` y no hay coincidencia',
    RESERVATION_NOT_FOUND,
  ),
  [UNSUPPORTED_PARAMETER.code]: listError(
    'Módulo 1: un parámetro que no es `dateFrom`, `dateTo` ni `roomId` (el primero en orden alfabético)',
    {
      code: UNSUPPORTED_PARAMETER.code,
      message: UNSUPPORTED_PARAMETER.message('page'),
    },
  ),
  [INVALID_ROOM_ID.code]: listError(
    'Módulo 1: `roomId` que no es un UUID',
    INVALID_ROOM_ID,
  ),
  [REQUEST_NOT_PROCESSED]: listError('Los dos: una excepción inesperada', {
    code: REQUEST_NOT_PROCESSED,
    message: REQUEST_NOT_PROCESSED_MESSAGE,
  }),
};
