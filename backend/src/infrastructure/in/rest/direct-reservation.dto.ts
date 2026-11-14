import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  AVAILABILITY_TAKEN,
  NO_AVAILABILITY,
} from '../../../application/use-cases/generate-direct-reservation/error-codes.js';
import type { DirectReservationPreview } from '../../../application/use-cases/generate-direct-reservation/ports/in/preview-direct-reservation.port.js';
import { CURRENCY_MISMATCH } from '../../../domain/reservation/reservation-total.js';
import { DOCUMENT_TYPES } from '../../../domain/shared/enums.js';
import {
  GUEST_COUNT_EXCEEDS_CAPACITY,
  GUEST_COUNT_TOO_LOW,
  GUEST_DATA_REQUIRED,
  INVALID_CATEGORY,
  INVALID_CHARACTERS,
  INVALID_DOCUMENT_TYPE,
  INVALID_EMAIL,
  INVALID_GUEST_COUNT,
  INVALID_RESERVATION_DATES,
  INVALID_ROOM_COUNT,
  INVALID_ROOM_ID,
  INVENTORY_UNAVAILABLE,
  MAINTENANCE_CHECK_UNAVAILABLE,
  NOTES_TOO_LONG,
  PRICING_UNAVAILABLE,
  RATE_CHANGED,
  ROOM_ALREADY_IN_RESERVATION,
  ROOM_NOT_AVAILABLE,
  START_DATE_IN_PAST,
} from '../../../domain/shared/error-codes.js';
import {
  type ApiErrorBody,
  REQUEST_NOT_PROCESSED,
  REQUEST_NOT_PROCESSED_MESSAGE,
} from '../../shared/api-error.js';
import { AvailabilityDto, toAvailabilityDto } from './availability.dto.js';
import { QuotesDto, toQuotesDto } from './quotes.dto.js';
import type { ReservationDetailBody } from './reservation-detail.dto.js';

/*
 * La documentación OpenAPI de la reserva directa (plan de `generate-direct-reservation`, contratos A y B,
 * tabla C y punto 13; T017). Las clases existen para que OpenAPI describa los cuerpos (plan base,
 * "Contratos REST"): un `type` no se puede leer. Los ejemplos son los del plan.
 */

/** Las habitaciones de los ejemplos del plan: la 201, la 202 y la 203 de `DOBLE`. */
const ROOM_201 = '3f6c1e2a-8b4d-4c7e-9a1f-2b3c4d5e6f70';
const ROOM_202 = '7a2d9c4e-1f3b-4e8a-b6c5-0d9e8f7a6b51';
const ROOM_203 = '0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e';

/** Una habitación pedida: sus personas y, si la Recepcionista la eligió, su `roomId`. */
export class RequestedRoomDto {
  @ApiProperty({
    description: 'Un entero de 1 a la capacidad de la habitación.',
    example: 2,
  })
  guestCount: number;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Opcional: la habitación que eligió la Recepcionista, de la misma categoría. Si no viene, se asigna la disponible de menor número.',
  })
  roomId?: string;
}

/** El cuerpo de A, `POST /api/reservations/direct/preview`. */
export class DirectReservationPreviewRequestDto {
  @ApiProperty({
    format: 'date',
    description: 'No anterior al día operativo en Colombia.',
    example: '2026-10-12',
  })
  startDate: string;

  @ApiProperty({
    format: 'date',
    description: 'Posterior a la entrada: es la salida.',
    example: '2026-10-15',
  })
  endDate: string;

  @ApiProperty({
    description: 'Una sola para toda la reserva.',
    example: 'DOBLE',
  })
  categoryRoom: string;

  @ApiProperty({
    type: [RequestedRoomDto],
    description: 'Una entrada por habitación, de 1 a 10.',
  })
  rooms: RequestedRoomDto[];
}

/** La solicitud de A del plan. */
export const PREVIEW_REQUEST_EXAMPLE = {
  startDate: '2026-10-12',
  endDate: '2026-10-15',
  categoryRoom: 'DOBLE',
  rooms: [{ guestCount: 2 }, { guestCount: 2 }],
};

/** El titular de la creación (B). */
export class DirectReservationGuestDto {
  @ApiProperty({ maxLength: 100, example: 'Valentina' })
  firstName: string;

  @ApiProperty({ maxLength: 100, example: 'Ospina' })
  lastName: string;

  @ApiProperty({ enum: DOCUMENT_TYPES, example: 'CC' })
  documentType: string;

  @ApiProperty({
    maxLength: 30,
    description: 'Letras, dígitos y guion.',
    example: '1144093552',
  })
  documentNumber: string;

  @ApiProperty({
    maxLength: 60,
    description:
      'El nombre del país: el huésped es extranjero si no es exactamente `Colombia`.',
    example: 'Colombia',
  })
  nationality: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 30,
    example: '+57 300 000 0000',
  })
  contactPhone?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 254,
    description: '`algo@dominio.ext`, sin espacios.',
    example: 'valentina@correo.com',
  })
  contactEmail?: string | null;
}

/** La tarifa que vio el solicitante para una habitación, por su posición. */
export class ExpectedRateDto {
  @ApiProperty({
    description: 'La posición de la habitación en `rooms`, desde 1.',
    example: 1,
  })
  position: number;

  @ApiProperty({
    pattern: '^\\d+\\.\\d{2}$',
    description: 'El `lodgingAmount` de la vista previa, con dos decimales.',
    example: '750000.00',
  })
  lodgingAmount: string;

  @ApiProperty({ pattern: '^[A-Z]{3}$', example: 'COP' })
  currency: string;
}

/** El cuerpo de B, `POST /api/reservations/direct`: el de A más el titular, las observaciones y las tarifas. */
export class DirectReservationCreationRequestDto extends DirectReservationPreviewRequestDto {
  @ApiProperty({ type: DirectReservationGuestDto })
  guest: DirectReservationGuestDto;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 500,
    example: 'Llegada después de las 8 p. m.',
  })
  notes?: string | null;

  @ApiProperty({
    type: [ExpectedRateDto],
    description:
      'Una por habitación. El servidor vuelve a cotizar y compara: si difiere, `RATE_CHANGED`. Nunca se guarda un monto enviado por el cliente.',
  })
  expectedRates: ExpectedRateDto[];
}

/** La solicitud de B del plan. */
export const CREATION_REQUEST_EXAMPLE = {
  ...PREVIEW_REQUEST_EXAMPLE,
  guest: {
    firstName: 'Valentina',
    lastName: 'Ospina',
    documentType: 'CC',
    documentNumber: '1144093552',
    nationality: 'Colombia',
    contactPhone: '+57 300 000 0000',
    contactEmail: 'valentina@correo.com',
  },
  notes: 'Llegada después de las 8 p. m.',
  expectedRates: [
    { position: 1, lodgingAmount: '750000.00', currency: 'COP' },
    { position: 2, lodgingAmount: '750000.00', currency: 'COP' },
  ],
};

/** Una habitación asignada en la respuesta de la vista previa (plan de `generate-direct-reservation`, A). */
export class AssignedRoomDto {
  @ApiProperty({
    description: 'La posición en `rooms`, desde 1.',
    example: 1,
  })
  position: number;

  @ApiProperty({ format: 'uuid' })
  roomId: string;

  @ApiProperty({ example: '201' })
  roomNumber: string;

  @ApiProperty({ example: 2 })
  maxCapacity: number;

  @ApiProperty({ example: 2 })
  guestCount: number;
}

/** La reserva que resultaría: solo la suma de personas. */
export class PreviewReservationDto {
  @ApiProperty({ example: 4 })
  guestCount: number;
}

/** La respuesta de `POST /api/reservations/direct/preview` (plan, A). */
export class DirectReservationPreviewDto {
  @ApiProperty({ type: AvailabilityDto })
  availability: AvailabilityDto;

  @ApiProperty({ type: [AssignedRoomDto] })
  assignedRooms: AssignedRoomDto[];

  /** Con el `total`, que no se guarda. El `quoteId` no sale hacia la pantalla. */
  @ApiProperty({
    type: QuotesDto,
    description:
      'Una cotización por habitación y el `total`, que no se guarda. El `quoteId` no sale.',
  })
  quotes: QuotesDto;

  @ApiProperty({ type: PreviewReservationDto })
  reservation: PreviewReservationDto;
}

/** La respuesta de `POST /api/reservations/direct/preview` (plan, A). */
export type DirectReservationPreviewBody = DirectReservationPreviewDto;

/** La respuesta 200 de A del plan, con la 203 reservada. */
export const PREVIEW_EXAMPLE: DirectReservationPreviewBody = {
  availability: {
    startDate: '2026-10-12',
    endDate: '2026-10-15',
    categoryRoom: 'DOBLE',
    availableCount: 2,
    rooms: [
      {
        roomId: ROOM_201,
        roomNumber: '201',
        available: true,
        reason: null,
        message: null,
      },
      {
        roomId: ROOM_202,
        roomNumber: '202',
        available: true,
        reason: null,
        message: null,
      },
      {
        roomId: ROOM_203,
        roomNumber: '203',
        available: false,
        reason: 'RESERVED',
        message: 'La habitación ya está reservada en esas fechas.',
      },
    ],
  },
  assignedRooms: [
    {
      position: 1,
      roomId: ROOM_201,
      roomNumber: '201',
      maxCapacity: 2,
      guestCount: 2,
    },
    {
      position: 2,
      roomId: ROOM_202,
      roomNumber: '202',
      maxCapacity: 2,
      guestCount: 2,
    },
  ],
  quotes: {
    rooms: ['1', '2'].map((key) => ({
      key,
      categoryRoom: 'DOBLE',
      nights: 3,
      nightlyRates: ['2026-10-12', '2026-10-13', '2026-10-14'].map((date) => ({
        date,
        rate: { amount: '250000.00', currency: 'COP' },
      })),
      lodgingAmount: { amount: '750000.00', currency: 'COP' },
    })),
    total: { amount: '1500000.00', currency: 'COP' },
  },
  reservation: { guestCount: 4 },
};

/** La respuesta 201 de B del plan: el detalle de la reserva creada, con la forma de C3. */
export const CREATION_EXAMPLE: ReservationDetailBody = {
  reservationRef: 'RSV-3F9A1C7B',
  status: 'ACTIVE',
  source: 'DIRECT',
  externalConfirmationCode: null,
  otaName: null,
  startDate: '2026-10-12',
  endDate: '2026-10-15',
  nights: 3,
  guestCount: 4,
  notes: 'Llegada después de las 8 p. m.',
  createdAt: '2026-10-09T09:14:00-05:00',
  updatedAt: '2026-10-09T09:14:00.123456-05:00',
  conflict: null,
  rooms: [
    {
      reservationRoomId: '1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e',
      roomId: ROOM_201,
      roomNumber: '201',
    },
    {
      reservationRoomId: '2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f',
      roomId: ROOM_202,
      roomNumber: '202',
    },
  ].map(({ reservationRoomId, roomId, roomNumber }) => ({
    reservationRoomId,
    roomId,
    roomNumber,
    categoryRoom: 'DOBLE',
    guestCount: 2,
    roomGrossAmount: { amount: '750000.00', currency: 'COP' },
    stayStatus: 'EXPECTED',
  })),
  guest: CREATION_REQUEST_EXAMPLE.guest,
  cancellation: null,
};

const PREVIEW_PATH = '/api/reservations/direct/preview';
const CREATION_PATH = '/api/reservations/direct';

function errorExample(
  path: string,
  summary: string,
  errorCode: string,
  message: string,
) {
  return {
    summary,
    value: {
      errorCode,
      message,
      timestamp: '2026-10-09T14:14:00.000Z',
      path,
    } satisfies ApiErrorBody,
  };
}

/** Los errores de la forma, las habitaciones y las fechas (pasos 1 a 3 de la regla 2), comunes a A y B. */
function requestErrors(path: string, withRates: boolean) {
  return {
    [INVALID_CATEGORY.code]: errorExample(
      path,
      'La categoría no tiene la forma acordada, o el Módulo 1 no la reconoce',
      INVALID_CATEGORY.code,
      INVALID_CATEGORY.message,
    ),
    [INVALID_ROOM_ID.code]: errorExample(
      path,
      'Un `roomId` que no es un UUID, que el Módulo 1 no reconoce o que no es de la categoría',
      INVALID_ROOM_ID.code,
      INVALID_ROOM_ID.message,
    ),
    ...(withRates
      ? {
          [RATE_CHANGED.code]: errorExample(
            path,
            '`expectedRates` no trae una tarifa válida por habitación, o la tarifa cambió al volver a cotizar',
            RATE_CHANGED.code,
            RATE_CHANGED.message,
          ),
        }
      : {}),
    [INVALID_ROOM_COUNT.code]: errorExample(
      path,
      '`rooms` no es una lista, o tiene 0 o más de 10 habitaciones',
      INVALID_ROOM_COUNT.code,
      INVALID_ROOM_COUNT.message,
    ),
    [ROOM_ALREADY_IN_RESERVATION.code]: errorExample(
      path,
      'El mismo `roomId` dos veces',
      ROOM_ALREADY_IN_RESERVATION.code,
      ROOM_ALREADY_IN_RESERVATION.message,
    ),
    [GUEST_COUNT_TOO_LOW.code]: errorExample(
      path,
      '`guestCount` igual a 0',
      GUEST_COUNT_TOO_LOW.code,
      GUEST_COUNT_TOO_LOW.message,
    ),
    [INVALID_GUEST_COUNT.code]: errorExample(
      path,
      '`guestCount` que no es un entero, o negativo',
      INVALID_GUEST_COUNT.code,
      INVALID_GUEST_COUNT.message,
    ),
    [INVALID_RESERVATION_DATES.code]: errorExample(
      path,
      'Fechas vacías o inexistentes, o la salida no posterior a la entrada',
      INVALID_RESERVATION_DATES.code,
      INVALID_RESERVATION_DATES.message,
    ),
    [START_DATE_IN_PAST.code]: errorExample(
      path,
      'La entrada es anterior al día operativo en Colombia',
      START_DATE_IN_PAST.code,
      START_DATE_IN_PAST.message,
    ),
  };
}

/** Los errores de la disponibilidad, la asignación y la capacidad (pasos 2 a 4 del punto 11), comunes a A y B. */
function availabilityErrors(path: string, withTaken: boolean) {
  return {
    [INVENTORY_UNAVAILABLE.code]: errorExample(
      path,
      'El Módulo 1 no responde al consultar el inventario',
      INVENTORY_UNAVAILABLE.code,
      INVENTORY_UNAVAILABLE.message,
    ),
    [MAINTENANCE_CHECK_UNAVAILABLE.code]: errorExample(
      path,
      'El Módulo 1 no responde al consultar los mantenimientos',
      MAINTENANCE_CHECK_UNAVAILABLE.code,
      MAINTENANCE_CHECK_UNAVAILABLE.message,
    ),
    [ROOM_NOT_AVAILABLE.code]: errorExample(
      path,
      'Una habitación pedida por `roomId` no está disponible',
      ROOM_NOT_AVAILABLE.code,
      ROOM_NOT_AVAILABLE.message('202'),
    ),
    [NO_AVAILABILITY.code]: errorExample(
      path,
      'No hay habitaciones disponibles suficientes de la categoría',
      NO_AVAILABILITY.code,
      NO_AVAILABILITY.message,
    ),
    [GUEST_COUNT_EXCEEDS_CAPACITY.code]: errorExample(
      path,
      '`guestCount` mayor que el `maxCapacity` de su habitación',
      GUEST_COUNT_EXCEEDS_CAPACITY.code,
      GUEST_COUNT_EXCEEDS_CAPACITY.message,
    ),
    // Solo B guarda la reserva: la restricción anti-solape la rechaza y no queda otra habitación (T009, D3).
    ...(withTaken
      ? {
          [AVAILABILITY_TAKEN.code]: errorExample(
            path,
            'Otra solicitud ocupó la habitación al guardar y no quedó otra habitación candidata',
            AVAILABILITY_TAKEN.code,
            AVAILABILITY_TAKEN.message,
          ),
        }
      : {}),
    [PRICING_UNAVAILABLE.code]: errorExample(
      path,
      'El Módulo 3 no responde al cotizar',
      PRICING_UNAVAILABLE.code,
      PRICING_UNAVAILABLE.message,
    ),
  };
}

/** Un ejemplo por cada error de A, en el orden en que se revisan (punto 13). */
export const PREVIEW_ERROR_EXAMPLES = {
  ...requestErrors(PREVIEW_PATH, false),
  ...availabilityErrors(PREVIEW_PATH, false),
  [CURRENCY_MISMATCH.code]: errorExample(
    PREVIEW_PATH,
    'El Módulo 3 cotiza las habitaciones en monedas distintas: no se puede sumar el total',
    CURRENCY_MISMATCH.code,
    CURRENCY_MISMATCH.message,
  ),
  [REQUEST_NOT_PROCESSED]: errorExample(
    PREVIEW_PATH,
    'Una excepción inesperada',
    REQUEST_NOT_PROCESSED,
    REQUEST_NOT_PROCESSED_MESSAGE,
  ),
};

/** Un ejemplo por cada error de B, en el orden en que se revisan (punto 13). */
export const CREATION_ERROR_EXAMPLES = {
  ...requestErrors(CREATION_PATH, true),
  [NOTES_TOO_LONG.code]: errorExample(
    CREATION_PATH,
    '`notes` de más de 500 caracteres',
    NOTES_TOO_LONG.code,
    NOTES_TOO_LONG.message,
  ),
  [GUEST_DATA_REQUIRED.code]: errorExample(
    CREATION_PATH,
    'Falta o llega vacío un dato obligatorio del titular',
    GUEST_DATA_REQUIRED.code,
    GUEST_DATA_REQUIRED.message,
  ),
  [INVALID_DOCUMENT_TYPE.code]: errorExample(
    CREATION_PATH,
    '`documentType` fuera de `RC`, `TI`, `CC`, `CE`, `PAS` y `NIT`',
    INVALID_DOCUMENT_TYPE.code,
    INVALID_DOCUMENT_TYPE.message,
  ),
  [INVALID_CHARACTERS.code]: errorExample(
    CREATION_PATH,
    'Caracteres no válidos o un texto que no cabe, en `notes` o en el titular',
    INVALID_CHARACTERS.code,
    INVALID_CHARACTERS.message,
  ),
  [INVALID_EMAIL.code]: errorExample(
    CREATION_PATH,
    '`contactEmail` sin la forma `algo@dominio.ext`',
    INVALID_EMAIL.code,
    INVALID_EMAIL.message,
  ),
  ...availabilityErrors(CREATION_PATH, true),
  [REQUEST_NOT_PROCESSED]: errorExample(
    CREATION_PATH,
    'Una excepción inesperada',
    REQUEST_NOT_PROCESSED,
    REQUEST_NOT_PROCESSED_MESSAGE,
  ),
};

/** Convierte la vista previa en el JSON de A, con los DTO compartidos `availability` y `quotes`. */
export function toDirectReservationPreviewBody(
  preview: DirectReservationPreview,
): DirectReservationPreviewBody {
  return {
    availability: toAvailabilityDto(preview.availability, preview.categoryRoom),
    assignedRooms: preview.assignedRooms.map(
      ({ position, room, guestCount }): AssignedRoomDto => ({
        position,
        roomId: room.id,
        roomNumber: room.roomNumber,
        maxCapacity: room.maxCapacity,
        guestCount,
      }),
    ),
    quotes: toQuotesDto(preview.quotes, preview.quoteRequests, true),
    reservation: { guestCount: preview.guestCount },
  };
}
