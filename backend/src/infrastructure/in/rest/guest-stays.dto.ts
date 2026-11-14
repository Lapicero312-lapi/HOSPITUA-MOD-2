import { ApiProperty } from '@nestjs/swagger';
import {
  GUEST_NOT_FOUND,
  INVALID_DOCUMENT_NUMBER,
  INVALID_NATIONALITY_FILTER,
  INVALID_PRESENCE_FILTER,
  INVALID_SEARCH,
} from '../../../application/use-cases/process-guest-data/error-codes.js';
import type { GuestStayDetail } from '../../../application/use-cases/process-guest-data/ports/in/get-guest-stay-detail.port.js';
import {
  GUEST_STAYS_PAGE_SIZE,
  type GuestStayPage,
  NO_GUEST_STAYS_MESSAGE,
} from '../../../application/use-cases/process-guest-data/ports/in/list-guest-stays.port.js';
import {
  type ApiErrorBody,
  REQUEST_NOT_PROCESSED,
  REQUEST_NOT_PROCESSED_MESSAGE,
} from '../../shared/api-error.js';

/** Los tipos de documento del plan base ("Enumerados"). */
const DOCUMENT_TYPES = ['RC', 'TI', 'CC', 'CE', 'PAS', 'NIT'];
const RESERVATION_REF_PATTERN = '^RSV-[0-9A-F]{8}$';

/**
 * El huésped en una fila de C1. Las clases de este archivo existen para que OpenAPI documente las
 * respuestas de `GET /api/guest-stays` y `GET /api/reservations/{reservationRef}/guests/{documentNumber}`
 * (plan base, "Contratos REST"): un `type` no se puede leer.
 */
export class GuestStayGuestDto {
  @ApiProperty({ example: 'John' })
  firstName: string;

  @ApiProperty({ example: 'Smith' })
  lastName: string;

  @ApiProperty({ enum: DOCUMENT_TYPES, example: 'PAS' })
  documentType: string;

  @ApiProperty({ example: 'X99' })
  documentNumber: string;

  @ApiProperty({ example: 'Estados Unidos' })
  nationality: string;

  @ApiProperty({
    description: '`true` si la nacionalidad no es Colombia.',
    example: true,
  })
  isForeign: boolean;
}

/** Una fila de C1: un huésped en una reserva, con su entrada y su salida. */
export class GuestStayDto {
  @ApiProperty({ pattern: RESERVATION_REF_PATTERN, example: 'RSV-3F9A1C7B' })
  reservationRef: string;

  @ApiProperty({ type: GuestStayGuestDto })
  guest: GuestStayGuestDto;

  @ApiProperty({
    type: String,
    format: 'date',
    nullable: true,
    description: '`null` si solo tiene salida.',
    example: '2026-10-09',
  })
  entryDate: string | null;

  @ApiProperty({
    type: String,
    format: 'date',
    nullable: true,
    description: '`null` cuando no tiene salida.',
    example: null,
  })
  exitDate: string | null;

  @ApiProperty({
    description:
      '`true` cuando no tiene salida: la pantalla muestra "En el hotel".',
    example: true,
  })
  inHotel: boolean;
}

/** La respuesta de C1, `GET /api/guest-stays`. */
export class GuestStayPageDto {
  @ApiProperty({
    type: [GuestStayDto],
    description:
      'Una fila por huésped y reserva: un huésped con varias estadías aparece varias veces. De la entrada más reciente a la más antigua; las filas sin entrada (solo salida), por su salida. Sin resultados, `[]`.',
  })
  items: GuestStayDto[];

  @ApiProperty({
    type: 'integer',
    minimum: 1,
    description:
      'La página devuelta: una que no existe se ajusta a la última válida.',
    example: 1,
  })
  page: number;

  @ApiProperty({
    type: 'integer',
    description: 'Tamaño fijo.',
    example: GUEST_STAYS_PAGE_SIZE,
  })
  pageSize: number;

  @ApiProperty({ type: 'integer', minimum: 0, example: 1 })
  totalItems: number;

  @ApiProperty({
    type: 'integer',
    minimum: 0,
    description: '`0` sin resultados.',
    example: 1,
  })
  totalPages: number;

  @ApiProperty({
    type: String,
    nullable: true,
    description: `Sin resultados, "${NO_GUEST_STAYS_MESSAGE}"; si no, \`null\`.`,
    example: null,
  })
  message: string | null;
}

/** El huésped en el detalle de C2. */
export class GuestStayDetailGuestDto {
  @ApiProperty({ enum: DOCUMENT_TYPES, example: 'PAS' })
  documentType: string;

  @ApiProperty({ example: 'X99' })
  documentNumber: string;

  @ApiProperty({ type: String, nullable: true, example: 'John' })
  firstName: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Smith' })
  lastName: string | null;

  @ApiProperty({ format: 'date', example: '1990-05-12' })
  birthDate: string;

  @ApiProperty({ type: String, nullable: true, example: 'Estados Unidos' })
  nationality: string | null;

  @ApiProperty({
    description: '`true` si la nacionalidad no es Colombia.',
    example: true,
  })
  isForeign: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      '`null` si está vacío (por ejemplo, el de un colombiano): la pantalla muestra una raya "—".',
    example: 'Miami, Estados Unidos',
  })
  originPlace: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: '`null` si está vacío: la pantalla muestra una raya "—".',
    example: 'Cartagena, Colombia',
  })
  destinationPlace: string | null;
}

/** Un movimiento del huésped en C2. */
export class GuestMovementDto {
  @ApiProperty({ enum: ['ENTRY', 'DEPARTURE'], example: 'ENTRY' })
  movementType: string;

  @ApiProperty({ format: 'date', example: '2026-10-09' })
  movementDate: string;
}

/** La respuesta de C2, `GET /api/reservations/{reservationRef}/guests/{documentNumber}`. */
export class GuestStayDetailDto {
  @ApiProperty({ pattern: RESERVATION_REF_PATTERN, example: 'RSV-3F9A1C7B' })
  reservationRef: string;

  @ApiProperty({
    description: 'El detalle de la reserva.',
    example: '/api/reservations/RSV-3F9A1C7B',
  })
  reservationLink: string;

  @ApiProperty({ type: GuestStayDetailGuestDto })
  guest: GuestStayDetailGuestDto;

  @ApiProperty({
    type: [GuestMovementDto],
    description:
      'Ordenados por fecha; puede traer solo la entrada o solo la salida.',
  })
  movements: GuestMovementDto[];
}

/** El ejemplo de C1 del plan: John, extranjero, en el hotel. */
export const GUEST_STAYS_EXAMPLE = {
  items: [
    {
      reservationRef: 'RSV-3F9A1C7B',
      guest: {
        firstName: 'John',
        lastName: 'Smith',
        documentType: 'PAS',
        documentNumber: 'X99',
        nationality: 'Estados Unidos',
        isForeign: true,
      },
      entryDate: '2026-10-09',
      exitDate: null,
      inHotel: true,
    },
  ],
  page: 1,
  pageSize: 10,
  totalItems: 1,
  totalPages: 1,
  message: null,
} satisfies GuestStayPage;

/** El ejemplo de C2 del plan: John, con su entrada y su salida. */
export const GUEST_STAY_DETAIL_EXAMPLE = {
  reservationRef: 'RSV-3F9A1C7B',
  reservationLink: '/api/reservations/RSV-3F9A1C7B',
  guest: {
    documentType: 'PAS',
    documentNumber: 'X99',
    firstName: 'John',
    lastName: 'Smith',
    birthDate: '1990-05-12',
    nationality: 'Estados Unidos',
    isForeign: true,
    originPlace: 'Miami, Estados Unidos',
    destinationPlace: 'Cartagena, Colombia',
  },
  movements: [
    { movementType: 'ENTRY', movementDate: '2026-10-09' },
    { movementType: 'DEPARTURE', movementDate: '2026-10-12' },
  ],
} satisfies GuestStayDetail;

const errorExample = (
  path: string,
  summary: string,
  errorCode: string,
  message: string,
) => ({
  summary,
  value: {
    errorCode,
    message,
    timestamp: '2026-10-11T15:00:00.000Z',
    path,
  } satisfies ApiErrorBody,
});

const guestStaysError = (summary: string, errorCode: string, message: string) =>
  errorExample('/api/guest-stays', summary, errorCode, message);

/**
 * Los errores que puede responder `GET /api/guest-stays`, todos con `400`: los de la tabla de C1, en su
 * orden, y la excepción inesperada ("REST (vista de huéspedes alojados)"). Los códigos compartidos van con
 * el literal de la tabla: la capa de entrada solo importa `application/` (plan base, tabla de capas), no
 * `domain/`.
 */
export const GUEST_STAYS_ERROR_EXAMPLES = {
  [INVALID_NATIONALITY_FILTER.code]: guestStaysError(
    '`nationality` fuera del enumerado',
    INVALID_NATIONALITY_FILTER.code,
    INVALID_NATIONALITY_FILTER.message,
  ),
  [INVALID_PRESENCE_FILTER.code]: guestStaysError(
    '`presence` fuera del enumerado',
    INVALID_PRESENCE_FILTER.code,
    INVALID_PRESENCE_FILTER.message,
  ),
  INVALID_DATE: guestStaysError(
    'Fecha mal formada o inexistente',
    'INVALID_DATE',
    'La fecha indicada no es válida.',
  ),
  INCOMPLETE_DATE_RANGE: guestStaysError(
    'Solo una de las dos fechas',
    'INCOMPLETE_DATE_RANGE',
    'Debe completar ambas fechas del rango.',
  ),
  INVALID_DATE_RANGE: guestStaysError(
    '`dateFrom` posterior a `dateTo`',
    'INVALID_DATE_RANGE',
    'La fecha inicial no puede ser posterior a la fecha final.',
  ),
  DATE_RANGE_TOO_LARGE: guestStaysError(
    'Más de un año (366 días)',
    'DATE_RANGE_TOO_LARGE',
    'El rango de fechas no puede superar 366 días.',
  ),
  NAME_SEARCH_TOO_SHORT: guestStaysError(
    'Nombre de menos de 3 caracteres',
    'NAME_SEARCH_TOO_SHORT',
    'La búsqueda por nombre requiere al menos 3 caracteres.',
  ),
  [INVALID_SEARCH.code]: guestStaysError(
    'Búsqueda vacía o con caracteres no permitidos',
    INVALID_SEARCH.code,
    INVALID_SEARCH.message,
  ),
  INVALID_PAGE: guestStaysError(
    '`page` menor que 1',
    'INVALID_PAGE',
    'El número de página debe ser 1 o mayor.',
  ),
  [REQUEST_NOT_PROCESSED]: guestStaysError(
    'Una excepción inesperada',
    REQUEST_NOT_PROCESSED,
    REQUEST_NOT_PROCESSED_MESSAGE,
  ),
};

/**
 * Los errores que puede responder `GET /api/reservations/{reservationRef}/guests/{documentNumber}`, todos
 * con `400` (plan, C2 y "REST (vista de huéspedes alojados)"). El de `INVALID_RESERVATION_CODE` va con el
 * literal del plan, por la misma razón que los compartidos de C1.
 */
export const GUEST_STAY_DETAIL_ERROR_EXAMPLES = {
  [GUEST_NOT_FOUND.code]: errorExample(
    '/api/reservations/RSV-00000000/guests/X99',
    'El huésped o la reserva no existen, o el huésped no tiene movimientos',
    GUEST_NOT_FOUND.code,
    GUEST_NOT_FOUND.message,
  ),
  INVALID_RESERVATION_CODE: errorExample(
    '/api/reservations/RSV-123/guests/X99',
    '`reservationRef` con formato inválido',
    'INVALID_RESERVATION_CODE',
    'Debe proveer un código de reserva válido para la consulta.',
  ),
  [INVALID_DOCUMENT_NUMBER.code]: errorExample(
    '/api/reservations/RSV-3F9A1C7B/guests/X99%3B',
    '`documentNumber` vacío o con caracteres no permitidos',
    INVALID_DOCUMENT_NUMBER.code,
    INVALID_DOCUMENT_NUMBER.message,
  ),
  [REQUEST_NOT_PROCESSED]: errorExample(
    '/api/reservations/RSV-3F9A1C7B/guests/X99',
    'Una excepción inesperada',
    REQUEST_NOT_PROCESSED,
    REQUEST_NOT_PROCESSED_MESSAGE,
  ),
};
