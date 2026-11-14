import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CATEGORY_MISMATCH,
  NATIONALITY_NOT_EDITABLE,
  OTA_RESERVATION_READ_ONLY,
  RESERVATION_NOT_IN_CONFLICT,
  ROOM_ALREADY_ASSIGNED,
  STATUS_NOT_EDITABLE,
} from '../../../application/use-cases/update-reservation/error-codes.js';
import type { ModificationPreview } from '../../../application/use-cases/update-reservation/ports/in/preview-modification.port.js';
import {
  CONCURRENT_UPDATE,
  GUEST_COUNT_EXCEEDS_CAPACITY,
  GUEST_COUNT_TOO_LOW,
  GUEST_DATA_REQUIRED,
  INVALID_CHARACTERS,
  INVALID_DOCUMENT_TYPE,
  INVALID_EMAIL,
  INVALID_GUEST_COUNT,
  INVALID_RESERVATION_DATES,
  INVALID_ROOM_COUNT,
  INVALID_ROOM_ID,
  INVENTORY_UNAVAILABLE,
  LAST_ROOM_CANNOT_BE_REMOVED,
  MAINTENANCE_CHECK_UNAVAILABLE,
  NOTES_TOO_LONG,
  RATE_CHANGED,
  RECALCULATION_UNAVAILABLE,
  RESERVATION_NOT_FOUND,
  ROOM_ALREADY_IN_RESERVATION,
  ROOM_NOT_AVAILABLE,
  START_DATE_IN_PAST,
} from '../../../domain/shared/error-codes.js';
import {
  REQUEST_NOT_PROCESSED,
  REQUEST_NOT_PROCESSED_MESSAGE,
} from '../../shared/api-error.js';
import { errorExample } from './openapi-examples.js';
import { type MoneyDto, QuotesDto, toQuotesDto } from './quotes.dto.js';

/** Una habitación verificada en la vista previa: si está libre en las fechas que quedarían. */
export type ModificationAvailabilityRoomDto = {
  roomId: string;
  roomNumber: string;
  available: boolean;
  reason: 'RESERVED' | 'MAINTENANCE' | null;
};

/** El cuerpo de la respuesta 200 de B1 (plan de `update-reservation`, contrato B y regla 8). */
export type ModificationPreviewBody = Omit<
  ModificationPreview,
  'availability' | 'quotes'
> & {
  availability: { rooms: ModificationAvailabilityRoomDto[] };
  /** Solo las habitaciones recotizadas, sin tarifa anterior ni diferencia, y el total de las que quedarían. */
  quotes: (QuotesDto & { total: MoneyDto }) | null;
};

/**
 * Escribe la vista previa como la recibe la pantalla: la disponibilidad con su `roomId`, su número, si está
 * libre y el motivo; y las cotizaciones con el DTO compartido de `calculate-dynamic-rate` (sin `total`) más
 * el total de todas las habitaciones que quedarían. El `quoteId` no sale.
 */
export function toModificationPreviewBody(
  preview: ModificationPreview,
): ModificationPreviewBody {
  const { availability, quotes, ...rest } = preview;
  return {
    ...rest,
    availability: {
      rooms: availability.map(({ room, available, reason }) => ({
        roomId: room.id,
        roomNumber: room.roomNumber,
        available,
        reason,
      })),
    },
    quotes:
      quotes === null
        ? null
        : {
            ...toQuotesDto(quotes.quotes, quotes.requests, false),
            total: {
              amount: quotes.total.amountWithCents,
              currency: quotes.total.currency,
            },
          },
  };
}

/*
 * La documentación OpenAPI de la modificación (plan de `update-reservation`, contrato B: B1, B2 y B3, y su
 * tabla de errores; T032). Las clases existen para que OpenAPI describa los cuerpos (plan base, "Contratos
 * REST"): un `type` no se puede leer. Los ejemplos son los del plan.
 */

/** La reserva de los ejemplos del plan. */
const EXAMPLE_REF = 'RSV-3F9A1C7B';
const PREVIEW_PATH = `/api/reservations/${EXAMPLE_REF}/modification-preview`;
const CONFIRM_PATH = `/api/reservations/${EXAMPLE_REF}`;
const ASSIGNMENT_PATH = `/api/reservations/${EXAMPLE_REF}/room-assignment`;
const UUID_EXAMPLE = '3f6c1e2a-8b4d-4c7e-9a1f-2b3c4d5e6f70';

export class ModificationRoomRequestDto {
  @ApiProperty({ format: 'uuid', example: UUID_EXAMPLE })
  roomId: string;

  @ApiProperty({ type: 'integer', minimum: 1, example: 2 })
  guestCount: number;
}

export class ModificationGuestRequestDto {
  @ApiProperty({ example: 'Ana' })
  firstName: string;

  @ApiProperty({ example: 'Pérez' })
  lastName: string;

  @ApiProperty({ enum: ['RC', 'TI', 'CC', 'CE', 'PAS', 'NIT'], example: 'CC' })
  documentType: string;

  @ApiProperty({ example: '123' })
  documentNumber: string;

  @ApiProperty({
    type: 'string',
    nullable: true,
    example: '+57 300 000 0000',
  })
  contactPhone: string | null;

  @ApiProperty({
    type: 'string',
    nullable: true,
    format: 'email',
    example: 'ana@correo.com',
  })
  contactEmail: string | null;
}

/** El cuerpo de cambio, el mismo en B1 y B2: todo opcional salvo `updatedAt`; lo que no viene queda igual. */
export class ModificationRequestDto {
  @ApiProperty({
    description:
      'El que leyó la pantalla en C3: el control de concurrencia (FR-008). Si no coincide, `CONCURRENT_UPDATE`.',
    example: '2026-10-08T15:42:10.123456-05:00',
  })
  updatedAt: string;

  @ApiPropertyOptional({ format: 'date', example: '2026-10-12' })
  startDate?: string;

  @ApiPropertyOptional({ format: 'date', example: '2026-10-15' })
  endDate?: string;

  @ApiPropertyOptional({
    type: [ModificationRoomRequestDto],
    description:
      'La lista completa de habitaciones que quedan (de 1 a 10): se conservan, agregan, quitan o cambian comparando con la actual.',
  })
  rooms?: ModificationRoomRequestDto[];

  @ApiPropertyOptional({
    type: ModificationGuestRequestDto,
    description:
      'El titular completo, sin `nationality`: la nacionalidad se fija al crear la reserva.',
  })
  guest?: ModificationGuestRequestDto;

  @ApiPropertyOptional({
    type: 'string',
    nullable: true,
    maxLength: 500,
    description: '`null` borra las observaciones.',
    example: 'Llegada tarde',
  })
  notes?: string | null;
}

export class ModificationExpectedRateDto {
  @ApiProperty({
    format: 'uuid',
    example: '7a2d9c4e-1f3b-4e8a-b6c5-0d9e8f7a6b51',
  })
  roomId: string;

  @ApiProperty({ pattern: '^\\d+\\.\\d{2}$', example: '1440000.00' })
  lodgingAmount: string;

  @ApiProperty({ pattern: '^[A-Z]{3}$', example: 'COP' })
  currency: string;
}

/** El cuerpo de B2: el de cambio más las tarifas que vio el solicitante. */
export class ModificationConfirmationRequestDto extends ModificationRequestDto {
  @ApiProperty({
    type: [ModificationExpectedRateDto],
    description:
      'El `lodgingAmount` de cada habitación recotizada en B1. Obligatorio si la vista previa tuvo `requiresConfirmation`; si no hay nada que recotizar, una lista vacía. El servidor vuelve a cotizar y compara (`RATE_CHANGED`): nunca guarda un monto del cliente.',
  })
  expectedRates: ModificationExpectedRateDto[];
}

export class ModificationChangesDto {
  @ApiProperty({ example: true })
  dates: boolean;

  @ApiProperty({ type: [String], format: 'uuid', example: [UUID_EXAMPLE] })
  roomsAdded: string[];

  @ApiProperty({ type: [String], format: 'uuid', example: [] })
  roomsRemoved: string[];

  @ApiProperty({
    type: 'array',
    items: { type: 'object' },
    description: 'Una habitación cambiada por otra.',
    example: [],
  })
  roomsSwapped: unknown[];

  @ApiProperty({ example: true })
  guestCountChanged: boolean;

  @ApiProperty({ example: false })
  guestChanged: boolean;

  @ApiProperty({ example: false })
  notesChanged: boolean;
}

export class ModificationAvailabilityRoomClass {
  @ApiProperty({ format: 'uuid', example: UUID_EXAMPLE })
  roomId: string;

  @ApiProperty({ example: '201' })
  roomNumber: string;

  @ApiProperty({ example: true })
  available: boolean;

  @ApiProperty({
    enum: ['RESERVED', 'MAINTENANCE'],
    nullable: true,
    example: null,
  })
  reason: 'RESERVED' | 'MAINTENANCE' | null;
}

export class ModificationAvailabilityDto {
  @ApiProperty({
    type: [ModificationAvailabilityRoomClass],
    description:
      'Las habitaciones verificadas: las que cambian de fechas o se agregan.',
  })
  rooms: ModificationAvailabilityRoomClass[];
}

export class ModificationResultingStayDto {
  @ApiProperty({ format: 'date', example: '2026-10-12' })
  startDate: string;

  @ApiProperty({ format: 'date', example: '2026-10-15' })
  endDate: string;

  @ApiProperty({ example: 3 })
  guestCount: number;
}

/** La respuesta 200 de B1. */
export class ModificationPreviewDto {
  @ApiProperty({ example: EXAMPLE_REF })
  reservationRef: string;

  @ApiProperty({ type: ModificationChangesDto })
  changes: ModificationChangesDto;

  @ApiProperty({
    description:
      '`true` solo cuando hay cotizaciones que el solicitante debe aceptar.',
    example: true,
  })
  requiresConfirmation: boolean;

  @ApiProperty({ type: ModificationAvailabilityDto })
  availability: ModificationAvailabilityDto;

  @ApiProperty({
    type: QuotesDto,
    nullable: true,
    description:
      'Solo las habitaciones recotizadas (`key` es su `roomId`), sin tarifa anterior ni diferencia; `total` suma todas las que quedarían. `null` si el cambio no recotiza.',
  })
  quotes: QuotesDto | null;

  @ApiProperty({ type: ModificationResultingStayDto })
  reservation: ModificationResultingStayDto;
}

/** El cuerpo de cambio del ejemplo de B del plan (los `roomId` del plan, completos). */
export const MODIFICATION_REQUEST_EXAMPLE = {
  updatedAt: '2026-10-08T15:42:10.123456-05:00',
  startDate: '2026-10-12',
  endDate: '2026-10-15',
  rooms: [
    { roomId: UUID_EXAMPLE, guestCount: 2 },
    { roomId: '7a2d9c4e-1f3b-4e8a-b6c5-0d9e8f7a6b51', guestCount: 1 },
  ],
  guest: {
    firstName: 'Ana',
    lastName: 'Pérez',
    documentType: 'CC',
    documentNumber: '123',
    contactPhone: '+57 300 000 0000',
    contactEmail: 'ana@correo.com',
  },
  notes: 'Llegada tarde',
};

/** El ejemplo de B2 del plan. */
export const MODIFICATION_CONFIRMATION_EXAMPLE = {
  updatedAt: '2026-10-08T15:42:10.123456-05:00',
  startDate: '2026-10-12',
  endDate: '2026-10-15',
  rooms: MODIFICATION_REQUEST_EXAMPLE.rooms,
  expectedRates: [
    {
      roomId: '7a2d9c4e-1f3b-4e8a-b6c5-0d9e8f7a6b51',
      lodgingAmount: '1440000.00',
      currency: 'COP',
    },
  ],
};

/** La respuesta del ejemplo de B1 del plan: se agrega la 305 y se cotiza solo ella. */
export const MODIFICATION_PREVIEW_EXAMPLE: ModificationPreviewBody = {
  reservationRef: EXAMPLE_REF,
  changes: {
    dates: true,
    roomsAdded: ['7a2d9c4e-1f3b-4e8a-b6c5-0d9e8f7a6b51'],
    roomsRemoved: [],
    roomsSwapped: [],
    guestCountChanged: true,
    guestChanged: false,
    notesChanged: false,
  },
  requiresConfirmation: true,
  availability: {
    rooms: [
      {
        roomId: UUID_EXAMPLE,
        roomNumber: '201',
        available: true,
        reason: null,
      },
      {
        roomId: '7a2d9c4e-1f3b-4e8a-b6c5-0d9e8f7a6b51',
        roomNumber: '305',
        available: true,
        reason: null,
      },
    ],
  },
  quotes: {
    rooms: [
      {
        key: '7a2d9c4e-1f3b-4e8a-b6c5-0d9e8f7a6b51',
        categoryRoom: 'SUITE',
        nights: 3,
        nightlyRates: [
          {
            date: '2026-10-12',
            rate: { amount: '480000.00', currency: 'COP' },
          },
          {
            date: '2026-10-13',
            rate: { amount: '480000.00', currency: 'COP' },
          },
          {
            date: '2026-10-14',
            rate: { amount: '480000.00', currency: 'COP' },
          },
        ],
        lodgingAmount: { amount: '1440000.00', currency: 'COP' },
      },
    ],
    total: { amount: '2130000.00', currency: 'COP' },
  },
  reservation: {
    startDate: '2026-10-12',
    endDate: '2026-10-15',
    guestCount: 3,
  },
};

export class RoomAssignmentDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'La habitación de la reserva sin asignar: su `reservationRoomId` de C3.',
    example: '7c1e9a2b-4d6f-4e8a-9b0c-1d2e3f4a5b6c',
  })
  reservationRoomId: string;

  @ApiProperty({
    format: 'uuid',
    description: 'La habitación elegida, de la misma categoría.',
    example: UUID_EXAMPLE,
  })
  roomId: string;
}

/** El cuerpo de B3. */
export class RoomAssignmentRequestDto {
  @ApiProperty({ example: '2026-11-08T10:00:00.000000-05:00' })
  updatedAt: string;

  @ApiProperty({ type: [RoomAssignmentDto], minItems: 1, maxItems: 10 })
  assignments: RoomAssignmentDto[];
}

/** El ejemplo de B3 del plan. */
export const ROOM_ASSIGNMENT_EXAMPLE = {
  updatedAt: '2026-11-08T10:00:00.000000-05:00',
  assignments: [
    {
      reservationRoomId: '7c1e9a2b-4d6f-4e8a-9b0c-1d2e3f4a5b6c',
      roomId: UUID_EXAMPLE,
    },
  ],
};

const codeExample = (
  path: string,
  summary: string,
  error: { code: string; message: string },
) => errorExample(path, summary, error.code, error.message);

/**
 * Un ejemplo por cada error de B1 y B2, en el orden en que se revisan (regla 3 y regla 7 de la modificación):
 * la forma del cuerpo sin consultar nada, la reserva, `updatedAt`, las fechas, las habitaciones con el
 * Módulo 1, el titular y las observaciones, la disponibilidad y la recotización. La referencia no se valida
 * por su formato: una que no existe, sea cual sea, es `RESERVATION_NOT_FOUND`.
 */
function modificationErrors(path: string) {
  return {
    [INVALID_RESERVATION_DATES.code]: codeExample(
      path,
      'Una fecha que no es texto; o, ya con la reserva, vacía, inexistente o con la salida no posterior a la entrada',
      INVALID_RESERVATION_DATES,
    ),
    [INVALID_ROOM_COUNT.code]: codeExample(
      path,
      '`rooms` que no es una lista, o con más de 10 habitaciones',
      INVALID_ROOM_COUNT,
    ),
    [INVALID_ROOM_ID.code]: codeExample(
      path,
      'Un `roomId` que no es un UUID, o que el Módulo 1 no conoce',
      INVALID_ROOM_ID,
    ),
    [INVALID_GUEST_COUNT.code]: codeExample(
      path,
      '`guestCount` que no es un número entero',
      INVALID_GUEST_COUNT,
    ),
    [RESERVATION_NOT_FOUND.code]: codeExample(
      path,
      'La reserva no existe',
      RESERVATION_NOT_FOUND,
    ),
    [OTA_RESERVATION_READ_ONLY.code]: codeExample(
      path,
      'Una reserva de Booking: solo se le puede asignar la habitación (B3)',
      OTA_RESERVATION_READ_ONLY,
    ),
    [STATUS_NOT_EDITABLE.code]: codeExample(
      path,
      'La reserva está en `IN_PROGRESS`, `COMPLETED`, `CANCELLED` o `NO_SHOW`',
      STATUS_NOT_EDITABLE,
    ),
    [CONCURRENT_UPDATE.code]: codeExample(
      path,
      '`updatedAt` no coincide: otra persona la modificó o la canceló',
      CONCURRENT_UPDATE,
    ),
    [START_DATE_IN_PAST.code]: codeExample(
      path,
      'Entrada anterior al día operativo',
      START_DATE_IN_PAST,
    ),
    [LAST_ROOM_CANNOT_BE_REMOVED.code]: codeExample(
      path,
      '`rooms` dejaría la reserva sin habitaciones',
      LAST_ROOM_CANNOT_BE_REMOVED,
    ),
    [ROOM_ALREADY_IN_RESERVATION.code]: codeExample(
      path,
      'Una habitación repetida en `rooms`',
      ROOM_ALREADY_IN_RESERVATION,
    ),
    [INVENTORY_UNAVAILABLE.code]: codeExample(
      path,
      'El Módulo 1 no responde al consultar una habitación',
      INVENTORY_UNAVAILABLE,
    ),
    [GUEST_COUNT_TOO_LOW.code]: codeExample(
      path,
      '`guestCount` menor que 1',
      GUEST_COUNT_TOO_LOW,
    ),
    [GUEST_COUNT_EXCEEDS_CAPACITY.code]: codeExample(
      path,
      '`guestCount` mayor que el `maxCapacity` de la habitación',
      GUEST_COUNT_EXCEEDS_CAPACITY,
    ),
    [NATIONALITY_NOT_EDITABLE.code]: codeExample(
      path,
      'El titular trae `nationality`',
      NATIONALITY_NOT_EDITABLE,
    ),
    [GUEST_DATA_REQUIRED.code]: codeExample(
      path,
      'Falta un dato obligatorio del titular',
      GUEST_DATA_REQUIRED,
    ),
    [INVALID_DOCUMENT_TYPE.code]: codeExample(
      path,
      'Un tipo de documento que no existe',
      INVALID_DOCUMENT_TYPE,
    ),
    [INVALID_CHARACTERS.code]: codeExample(
      path,
      'Caracteres de control en el titular o en `notes`, o un dato que no es texto',
      INVALID_CHARACTERS,
    ),
    [NOTES_TOO_LONG.code]: codeExample(
      path,
      '`notes` de más de 500 caracteres',
      NOTES_TOO_LONG,
    ),
    [INVALID_EMAIL.code]: codeExample(
      path,
      'El correo del titular no tiene su forma',
      INVALID_EMAIL,
    ),
    [ROOM_NOT_AVAILABLE.code]: errorExample(
      path,
      'Una habitación no está disponible (también si la restricción anti-solape rechaza el guardado)',
      ROOM_NOT_AVAILABLE.code,
      'La habitación 305 no está disponible para el rango de fechas solicitado.',
    ),
    [MAINTENANCE_CHECK_UNAVAILABLE.code]: codeExample(
      path,
      'El Módulo 1 no responde al consultar el calendario de mantenimientos',
      MAINTENANCE_CHECK_UNAVAILABLE,
    ),
    [RECALCULATION_UNAVAILABLE.code]: codeExample(
      path,
      'El Módulo 3 no responde al recotizar',
      RECALCULATION_UNAVAILABLE,
    ),
    [REQUEST_NOT_PROCESSED]: errorExample(
      path,
      'Una excepción inesperada',
      REQUEST_NOT_PROCESSED,
      REQUEST_NOT_PROCESSED_MESSAGE,
    ),
  };
}

export const MODIFICATION_PREVIEW_ERROR_EXAMPLES =
  modificationErrors(PREVIEW_PATH);

/**
 * Los de B1 más `RATE_CHANGED`, que solo responde la confirmación. Puede salir ya en el paso 1 (si
 * `expectedRates` no es una lista válida), así que va después de los errores de forma del cuerpo; también
 * sale al final, si la recotización no coincide con lo que vio el solicitante.
 */
const { [REQUEST_NOT_PROCESSED]: unexpected, ...confirmationSteps } =
  modificationErrors(CONFIRM_PATH);
const [shapeErrors, laterErrors] = [
  Object.entries(confirmationSteps).slice(0, 4),
  Object.entries(confirmationSteps).slice(4),
];
export const MODIFICATION_CONFIRMATION_ERROR_EXAMPLES = {
  ...Object.fromEntries(shapeErrors),
  [RATE_CHANGED.code]: codeExample(
    CONFIRM_PATH,
    '`expectedRates` mal formado, o la tarifa recotizada no es la que vio el solicitante',
    RATE_CHANGED,
  ),
  ...Object.fromEntries(laterErrors),
  [REQUEST_NOT_PROCESSED]: unexpected,
};

/** Los errores de B3: la cabecera `X-User` y después los pasos del punto 16 en orden. */
export const ROOM_ASSIGNMENT_ERROR_EXAMPLES = {
  USER_REQUIRED: errorExample(
    ASSIGNMENT_PATH,
    'Falta la cabecera `X-User`',
    'USER_REQUIRED',
    'Falta el usuario que hace la acción.',
  ),
  INVALID_USER: errorExample(
    ASSIGNMENT_PATH,
    '`X-User` de más de 100 caracteres',
    'INVALID_USER',
    'El usuario que hace la acción no es válido.',
  ),
  [INVALID_ROOM_ID.code]: codeExample(
    ASSIGNMENT_PATH,
    '`assignments` vacía o de más de 10, o un id que no es un UUID',
    INVALID_ROOM_ID,
  ),
  [ROOM_ALREADY_IN_RESERVATION.code]: codeExample(
    ASSIGNMENT_PATH,
    'Un `roomId` o un `reservationRoomId` repetido',
    ROOM_ALREADY_IN_RESERVATION,
  ),
  [RESERVATION_NOT_FOUND.code]: codeExample(
    ASSIGNMENT_PATH,
    'La reserva no existe',
    RESERVATION_NOT_FOUND,
  ),
  [RESERVATION_NOT_IN_CONFLICT.code]: codeExample(
    ASSIGNMENT_PATH,
    'La reserva no es de Booking o no está en conflicto',
    RESERVATION_NOT_IN_CONFLICT,
  ),
  [STATUS_NOT_EDITABLE.code]: codeExample(
    ASSIGNMENT_PATH,
    'La reserva de Booking se canceló o no se presentó',
    STATUS_NOT_EDITABLE,
  ),
  [CONCURRENT_UPDATE.code]: codeExample(
    ASSIGNMENT_PATH,
    '`updatedAt` no coincide',
    CONCURRENT_UPDATE,
  ),
  [ROOM_ALREADY_ASSIGNED.code]: codeExample(
    ASSIGNMENT_PATH,
    'Esa habitación de la reserva ya tiene número, o no es de la reserva',
    ROOM_ALREADY_ASSIGNED,
  ),
  [INVENTORY_UNAVAILABLE.code]: codeExample(
    ASSIGNMENT_PATH,
    'El Módulo 1 no responde al consultar la habitación elegida',
    INVENTORY_UNAVAILABLE,
  ),
  [CATEGORY_MISMATCH.code]: codeExample(
    ASSIGNMENT_PATH,
    'La habitación elegida es de otra categoría',
    CATEGORY_MISMATCH,
  ),
  [GUEST_COUNT_EXCEEDS_CAPACITY.code]: codeExample(
    ASSIGNMENT_PATH,
    'La habitación elegida tiene menos capacidad que las personas',
    GUEST_COUNT_EXCEEDS_CAPACITY,
  ),
  [ROOM_NOT_AVAILABLE.code]: errorExample(
    ASSIGNMENT_PATH,
    'La habitación elegida no está libre en esas fechas',
    ROOM_NOT_AVAILABLE.code,
    'La habitación 201 no está disponible para el rango de fechas solicitado.',
  ),
  [MAINTENANCE_CHECK_UNAVAILABLE.code]: codeExample(
    ASSIGNMENT_PATH,
    'El Módulo 1 no responde al consultar el calendario de mantenimientos',
    MAINTENANCE_CHECK_UNAVAILABLE,
  ),
  [REQUEST_NOT_PROCESSED]: errorExample(
    ASSIGNMENT_PATH,
    'Una excepción inesperada',
    REQUEST_NOT_PROCESSED,
    REQUEST_NOT_PROCESSED_MESSAGE,
  ),
};
