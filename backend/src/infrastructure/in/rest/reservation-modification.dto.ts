import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  NATIONALITY_NOT_EDITABLE,
  OTA_RESERVATION_READ_ONLY,
  RESERVATION_NOT_IN_CONFLICT,
  ROOM_ALREADY_ASSIGNED,
  CATEGORY_MISMATCH,
  STATUS_NOT_EDITABLE,
} from '../../../application/use-cases/update-reservation/error-codes.js';
import type { ModificationPreview } from '../../../application/use-cases/update-reservation/ports/in/preview-modification.port.js';
import { DOCUMENT_TYPES } from '../../../domain/shared/enums.js';
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
  type ApiErrorBody,
  REQUEST_NOT_PROCESSED,
  REQUEST_NOT_PROCESSED_MESSAGE,
} from '../../shared/api-error.js';
import { type MoneyDto, QuotesDto, toQuotesDto } from './quotes.dto.js';
import type { ReservationDetailBody } from './reservation-detail.dto.js';

/*
 * La documentación OpenAPI de la modificación de una reserva directa (B1 y B2) y de la asignación de
 * habitación a una reserva de Booking en conflicto (B3), del plan de `update-reservation` (contrato B, reglas
 * 3, 7, 8 y 9, y punto 16; T032). Las clases existen para que OpenAPI describa los cuerpos (plan base,
 * "Contratos REST"): un `type` no se puede leer. Los ejemplos son los del plan, con UUID completos. La
 * respuesta de B2 y la de B3 son el detalle de la reserva (C3 de `check-view-reservation`).
 */

/** Las habitaciones de los ejemplos del plan: la 201 y la 305 (`SUITE`). */
const ROOM_201 = '3f6c1e2a-8b4d-4c7e-9a1f-2b3c4d5e6f70';
const ROOM_305 = '5b8e2f0c-6a7d-4c19-8e3b-1d2c3b4a5f60';
/** B3: la habitación 204 que se asigna, y la habitación de la reserva sin asignar. */
const ROOM_204 = 'a4c2e6f8-1b3d-4e5f-8a7b-9c0d1e2f3a4b';
const RESERVATION_ROOM_ID = '7c1e9a2b-4d6f-4e8a-9b0c-1d2e3f4a5b6c';

/** La reserva de los ejemplos del plan. */
const EXAMPLE_REF = 'RSV-3F9A1C7B';
const UPDATED_AT = '2026-10-08T15:42:10.123456-05:00';

/** Una habitación que queda en la reserva: su `roomId` y sus personas. */
export class ModificationRoomDto {
  @ApiProperty({ format: 'uuid', example: ROOM_201 })
  roomId: string;

  @ApiProperty({
    description: 'Un entero de 1 a la capacidad de la habitación.',
    example: 2,
  })
  guestCount: number;
}

/** El titular de la modificación: todos sus datos, salvo la nacionalidad, que se fija al crear la reserva. */
export class ModificationGuestDto {
  @ApiProperty({ maxLength: 100, example: 'Ana' })
  firstName: string;

  @ApiProperty({ maxLength: 100, example: 'Pérez' })
  lastName: string;

  @ApiProperty({ enum: DOCUMENT_TYPES, example: 'CC' })
  documentType: string;

  @ApiProperty({
    maxLength: 30,
    description: 'Letras, dígitos y guion.',
    example: '123',
  })
  documentNumber: string;

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
    example: 'ana@correo.com',
  })
  contactEmail?: string | null;
}

/**
 * El cuerpo de cambio de B1 y B2. Todo es opcional salvo `updatedAt`: lo que no se envía queda igual.
 */
export class ModificationRequestDto {
  @ApiProperty({
    description:
      'El `updatedAt` que la pantalla leyó de la reserva (el detalle, C3 de `check-view-reservation`): es el control de concurrencia (FR-008). Si no coincide, `CONCURRENT_UPDATE`.',
    example: UPDATED_AT,
  })
  updatedAt: string;

  @ApiPropertyOptional({
    format: 'date',
    description: 'No anterior al día operativo en Colombia.',
    example: '2026-10-12',
  })
  startDate?: string;

  @ApiPropertyOptional({
    format: 'date',
    description: 'Posterior a la entrada: es la salida.',
    example: '2026-10-15',
  })
  endDate?: string;

  @ApiPropertyOptional({
    type: [ModificationRoomDto],
    description:
      'Cuando viene, es la **lista completa** de habitaciones que quedan en la reserva (de 1 a 10). El sistema la compara con la actual para saber cuáles se conservan, agregan, quitan o cambian.',
  })
  rooms?: ModificationRoomDto[];

  @ApiPropertyOptional({
    type: ModificationGuestDto,
    description:
      'Los datos del titular, sin `nationality`: si la trae, `NATIONALITY_NOT_EDITABLE`.',
  })
  guest?: ModificationGuestDto;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 500,
    description: 'Con `null` se borran las observaciones.',
    example: 'Llegada tarde',
  })
  notes?: string | null;
}

/** La tarifa que vio el solicitante para una habitación recotizada, por su `roomId`. */
export class ModificationExpectedRateDto {
  @ApiProperty({ format: 'uuid', example: ROOM_305 })
  roomId: string;

  @ApiProperty({
    pattern: '^\\d+\\.\\d{2}$',
    description:
      'El `lodgingAmount` de `quotes.rooms` de B1, con dos decimales.',
    example: '1440000.00',
  })
  lodgingAmount: string;

  @ApiProperty({ pattern: '^[A-Z]{3}$', example: 'COP' })
  currency: string;
}

/** El cuerpo de B2: el de cambio más las tarifas que el solicitante vio. */
export class ModificationConfirmationRequestDto extends ModificationRequestDto {
  @ApiPropertyOptional({
    type: [ModificationExpectedRateDto],
    description:
      'Obligatorio cuando la vista previa tuvo `requiresConfirmation: true`. El servidor vuelve a cotizar y compara el monto y la moneda: si difieren, `RATE_CHANGED`. Nunca se guarda un monto enviado por el cliente.',
  })
  expectedRates?: ModificationExpectedRateDto[];
}

/** La solicitud de B1 del plan: el cuerpo de cambio completo. */
export const MODIFICATION_REQUEST_EXAMPLE = {
  updatedAt: UPDATED_AT,
  startDate: '2026-10-12',
  endDate: '2026-10-15',
  rooms: [
    { roomId: ROOM_201, guestCount: 2 },
    { roomId: ROOM_305, guestCount: 1 },
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

/** La solicitud de B2 del plan: el cambio de fechas y habitaciones, con la tarifa que vio el solicitante. */
export const MODIFICATION_CONFIRMATION_EXAMPLE = {
  updatedAt: UPDATED_AT,
  startDate: '2026-10-12',
  endDate: '2026-10-15',
  rooms: [
    { roomId: ROOM_201, guestCount: 2 },
    { roomId: ROOM_305, guestCount: 1 },
  ],
  expectedRates: [
    { roomId: ROOM_305, lodgingAmount: '1440000.00', currency: 'COP' },
  ],
};

/** Una habitación cambiada: la que sale y la que entra. */
export class ModificationSwapDto {
  @ApiProperty({ format: 'uuid' })
  from: string;

  @ApiProperty({ format: 'uuid' })
  to: string;
}

/** Qué cambia (B1). */
export class ModificationChangesDto {
  @ApiProperty({
    description: '`startDate` o `endDate` distintas de las actuales.',
  })
  dates: boolean;

  @ApiProperty({
    type: [String],
    format: 'uuid',
    description: 'El `roomId` de las agregadas, en el orden de la solicitud.',
  })
  roomsAdded: string[];

  @ApiProperty({
    type: [String],
    format: 'uuid',
    description:
      'El `roomId` de las quitadas, por número de habitación ascendente.',
  })
  roomsRemoved: string[];

  @ApiProperty({
    type: [ModificationSwapDto],
    description:
      'Las cambiadas, de la misma o de otra categoría: el `roomId` de la que sale y el de la que entra.',
  })
  roomsSwapped: ModificationSwapDto[];

  @ApiProperty({
    description:
      'Cambia la suma de personas de la reserva, o las de una habitación conservada.',
  })
  guestCountChanged: boolean;

  @ApiProperty({
    description: 'El titular viene y algún dato difiere del actual.',
  })
  guestChanged: boolean;

  @ApiProperty({ description: '`notes` viene y difiere de las actuales.' })
  notesChanged: boolean;
}

/** Una habitación verificada en la vista previa: si está libre en las fechas que quedarían. */
export class ModificationAvailabilityRoomDto {
  @ApiProperty({ format: 'uuid', example: ROOM_201 })
  roomId: string;

  @ApiProperty({ example: '201' })
  roomNumber: string;

  @ApiProperty({ example: true })
  available: boolean;

  @ApiProperty({
    type: String,
    enum: ['RESERVED', 'MAINTENANCE'],
    nullable: true,
    description: 'Por qué no está libre; `null` si lo está.',
  })
  reason: 'RESERVED' | 'MAINTENANCE' | null;
}

/** La disponibilidad de las habitaciones verificadas. */
export class ModificationAvailabilityDto {
  @ApiProperty({
    type: [ModificationAvailabilityRoomDto],
    description:
      'Las que cambian de fechas o se agregan, en el orden de la solicitud; `[]` si no se verificó ninguna.',
  })
  rooms: ModificationAvailabilityRoomDto[];
}

/** Cómo quedaría la reserva. */
export class ModificationPreviewReservationDto {
  @ApiProperty({ format: 'date', example: '2026-10-12' })
  startDate: string;

  @ApiProperty({ format: 'date', example: '2026-10-15' })
  endDate: string;

  @ApiProperty({
    description: 'La suma de personas de todas las habitaciones.',
    example: 3,
  })
  guestCount: number;
}

/** La respuesta 200 de B1. La forma de `quotes` es la compartida con `calculate-dynamic-rate`. */
export class ModificationPreviewDto {
  @ApiProperty({ pattern: '^RSV-[0-9A-F]{8}$', example: EXAMPLE_REF })
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
      'Solo las habitaciones **recotizadas** (`key` es su `roomId`), con el mismo detalle que al crear la reserva y sin tarifa anterior ni diferencia, y el `total` de **todas** las que quedarían (no se guarda). `null` si el cambio no recotiza. El `quoteId` no sale.',
  })
  quotes: (QuotesDto & { total: MoneyDto }) | null;

  @ApiProperty({ type: ModificationPreviewReservationDto })
  reservation: ModificationPreviewReservationDto;
}

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

/** La respuesta 200 de B1 del plan: con la 305 agregada, que es lo único que se recotiza. */
export const MODIFICATION_PREVIEW_EXAMPLE: ModificationPreviewBody = {
  reservationRef: EXAMPLE_REF,
  changes: {
    dates: true,
    roomsAdded: [ROOM_305],
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
        roomId: ROOM_201,
        roomNumber: '201',
        available: true,
        reason: null,
      },
      {
        roomId: ROOM_305,
        roomNumber: '305',
        available: true,
        reason: null,
      },
    ],
  },
  quotes: {
    rooms: [
      {
        key: ROOM_305,
        categoryRoom: 'SUITE',
        nights: 3,
        nightlyRates: ['2026-10-12', '2026-10-13', '2026-10-14'].map(
          (date) => ({
            date,
            rate: { amount: '480000.00', currency: 'COP' },
          }),
        ),
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

/** La reserva de B2 del plan: la directa con la 305 agregada, tal como la devuelve C3. */
export const MODIFICATION_CONFIRMATION_RESPONSE_EXAMPLE: ReservationDetailBody =
  {
    reservationRef: EXAMPLE_REF,
    status: 'ACTIVE',
    source: 'DIRECT',
    externalConfirmationCode: null,
    otaName: null,
    startDate: '2026-10-12',
    endDate: '2026-10-15',
    nights: 3,
    guestCount: 3,
    notes: 'Llegada tarde',
    createdAt: '2026-10-01T09:14:00-05:00',
    updatedAt: '2026-10-09T10:20:31.654321-05:00',
    conflict: null,
    rooms: [
      {
        reservationRoomId: RESERVATION_ROOM_ID,
        roomId: ROOM_201,
        roomNumber: '201',
        categoryRoom: 'DOBLE',
        guestCount: 2,
        roomGrossAmount: { amount: '690000.00', currency: 'COP' },
        stayStatus: 'EXPECTED',
      },
      {
        reservationRoomId: '9e4b6d2f-1a3c-4f5e-8b7d-0c1d2e3f4a5b',
        roomId: ROOM_305,
        roomNumber: '305',
        categoryRoom: 'SUITE',
        guestCount: 1,
        roomGrossAmount: { amount: '1440000.00', currency: 'COP' },
        stayStatus: 'EXPECTED',
      },
    ],
    guest: {
      firstName: 'Ana',
      lastName: 'Pérez',
      documentType: 'CC',
      documentNumber: '123',
      nationality: 'Colombia',
      contactPhone: '+57 300 000 0000',
      contactEmail: 'ana@correo.com',
    },
    cancellation: null,
  };

/** Una asignación de B3: a cuál habitación sin asignar de la reserva y qué habitación se le da. */
export class RoomAssignmentDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'El `reservationRoomId` de la habitación sin asignar (en el detalle de la reserva, C3).',
    example: RESERVATION_ROOM_ID,
  })
  reservationRoomId: string;

  @ApiProperty({
    format: 'uuid',
    description: 'La habitación del Módulo 1 que se le asigna.',
    example: ROOM_204,
  })
  roomId: string;
}

/** El cuerpo de B3, `PATCH /api/reservations/{reservationRef}/room-assignment`. */
export class RoomAssignmentRequestDto {
  @ApiProperty({
    description:
      'El `updatedAt` que la pantalla leyó de la reserva (C3): es el control de concurrencia. Si no coincide, `CONCURRENT_UPDATE`.',
    example: '2026-11-08T10:00:00.000000-05:00',
  })
  updatedAt: string;

  @ApiProperty({
    type: [RoomAssignmentDto],
    minItems: 1,
    maxItems: 10,
    description:
      'De 1 a 10 asignaciones, sin repetir ni la habitación sin asignar ni la elegida.',
  })
  assignments: RoomAssignmentDto[];
}

/** La solicitud de B3 del plan. */
export const ROOM_ASSIGNMENT_REQUEST_EXAMPLE = {
  updatedAt: '2026-11-08T10:00:00.000000-05:00',
  assignments: [{ reservationRoomId: RESERVATION_ROOM_ID, roomId: ROOM_204 }],
};

/** La respuesta 200 de B3: la reserva de Booking con su habitación asignada y, ya sin pendientes, sin conflicto. */
export const ROOM_ASSIGNMENT_RESPONSE_EXAMPLE: ReservationDetailBody = {
  reservationRef: EXAMPLE_REF,
  status: 'ACTIVE',
  source: 'OTA',
  externalConfirmationCode: '4417829013',
  otaName: 'Booking.com',
  startDate: '2026-11-10',
  endDate: '2026-11-12',
  nights: 2,
  guestCount: 2,
  notes: null,
  createdAt: '2026-11-08T09:14:00-05:00',
  updatedAt: '2026-11-08T10:05:12.345678-05:00',
  conflict: null,
  rooms: [
    {
      reservationRoomId: RESERVATION_ROOM_ID,
      roomId: ROOM_204,
      roomNumber: '204',
      categoryRoom: 'DOBLE',
      guestCount: 2,
      roomGrossAmount: null,
      stayStatus: 'EXPECTED',
    },
  ],
  guest: {
    firstName: 'Valentina',
    lastName: 'Ospina',
    documentType: null,
    documentNumber: null,
    nationality: 'Colombia',
    contactPhone: null,
    contactEmail: 'valentina@correo.com',
  },
  cancellation: null,
};

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
      timestamp: '2026-10-09T15:15:20.000Z',
      path,
    } satisfies ApiErrorBody,
  };
}

/**
 * Los errores `400` de B1 y de B2 (los mismos), un ejemplo por código y en el orden en que se revisan (regla
 * 3 del plan): la forma del cuerpo, la reserva, `updatedAt`, las fechas, las habitaciones, las personas, el
 * titular y las observaciones, la disponibilidad y la cotización; y, solo en B2, la tarifa. Un código que se
 * revisa en dos pasos (`INVALID_ROOM_ID`, `INVALID_RESERVATION_DATES`, `INVALID_ROOM_COUNT`) sale una vez.
 */
export function modificationErrorExamples(path: string, confirmation: boolean) {
  const examples = {
    [INVALID_RESERVATION_DATES.code]: errorExample(
      path,
      '`startDate` o `endDate` que no son texto, que no son una fecha real o con la salida no posterior a la entrada',
      INVALID_RESERVATION_DATES.code,
      INVALID_RESERVATION_DATES.message,
    ),
    [INVALID_ROOM_COUNT.code]: errorExample(
      path,
      '`rooms` que no es una lista, o con más de 10 habitaciones',
      INVALID_ROOM_COUNT.code,
      INVALID_ROOM_COUNT.message,
    ),
    [INVALID_ROOM_ID.code]: errorExample(
      path,
      'Un `roomId` que no es un UUID, o que el Módulo 1 no reconoce',
      INVALID_ROOM_ID.code,
      INVALID_ROOM_ID.message,
    ),
    [INVALID_GUEST_COUNT.code]: errorExample(
      path,
      'Un `guestCount` que no es un número entero',
      INVALID_GUEST_COUNT.code,
      INVALID_GUEST_COUNT.message,
    ),
    [RESERVATION_NOT_FOUND.code]: errorExample(
      path,
      'La reserva no existe (también con una referencia mal formada)',
      RESERVATION_NOT_FOUND.code,
      RESERVATION_NOT_FOUND.message,
    ),
    [OTA_RESERVATION_READ_ONLY.code]: errorExample(
      path,
      'La Recepcionista modifica una reserva de Booking',
      OTA_RESERVATION_READ_ONLY.code,
      OTA_RESERVATION_READ_ONLY.message,
    ),
    [STATUS_NOT_EDITABLE.code]: errorExample(
      path,
      'La reserva está en `IN_PROGRESS`, `COMPLETED`, `CANCELLED` o `NO_SHOW`',
      STATUS_NOT_EDITABLE.code,
      STATUS_NOT_EDITABLE.message,
    ),
    [CONCURRENT_UPDATE.code]: errorExample(
      path,
      '`updatedAt` no coincide (o no viene): otra persona modificó o canceló la reserva',
      CONCURRENT_UPDATE.code,
      CONCURRENT_UPDATE.message,
    ),
    [START_DATE_IN_PAST.code]: errorExample(
      path,
      'La entrada es anterior al día operativo en curso',
      START_DATE_IN_PAST.code,
      START_DATE_IN_PAST.message,
    ),
    [LAST_ROOM_CANNOT_BE_REMOVED.code]: errorExample(
      path,
      '`rooms` vacía: la reserva quedaría sin habitaciones',
      LAST_ROOM_CANNOT_BE_REMOVED.code,
      LAST_ROOM_CANNOT_BE_REMOVED.message,
    ),
    [ROOM_ALREADY_IN_RESERVATION.code]: errorExample(
      path,
      'Una habitación repetida en `rooms`',
      ROOM_ALREADY_IN_RESERVATION.code,
      ROOM_ALREADY_IN_RESERVATION.message,
    ),
    [INVENTORY_UNAVAILABLE.code]: errorExample(
      path,
      'El Módulo 1 no responde al consultar las habitaciones',
      INVENTORY_UNAVAILABLE.code,
      INVENTORY_UNAVAILABLE.message,
    ),
    [GUEST_COUNT_TOO_LOW.code]: errorExample(
      path,
      'Un `guestCount` menor que 1',
      GUEST_COUNT_TOO_LOW.code,
      GUEST_COUNT_TOO_LOW.message,
    ),
    [GUEST_COUNT_EXCEEDS_CAPACITY.code]: errorExample(
      path,
      'Un `guestCount` mayor que la capacidad de la habitación',
      GUEST_COUNT_EXCEEDS_CAPACITY.code,
      GUEST_COUNT_EXCEEDS_CAPACITY.message,
    ),
    [NATIONALITY_NOT_EDITABLE.code]: errorExample(
      path,
      '`guest` trae `nationality`, con cualquier valor',
      NATIONALITY_NOT_EDITABLE.code,
      NATIONALITY_NOT_EDITABLE.message,
    ),
    [GUEST_DATA_REQUIRED.code]: errorExample(
      path,
      'El titular viene incompleto: faltan nombre, apellido, tipo o número de documento',
      GUEST_DATA_REQUIRED.code,
      GUEST_DATA_REQUIRED.message,
    ),
    [INVALID_DOCUMENT_TYPE.code]: errorExample(
      path,
      'Un tipo de documento que no existe',
      INVALID_DOCUMENT_TYPE.code,
      INVALID_DOCUMENT_TYPE.message,
    ),
    [INVALID_EMAIL.code]: errorExample(
      path,
      'Un correo mal formado',
      INVALID_EMAIL.code,
      INVALID_EMAIL.message,
    ),
    [INVALID_CHARACTERS.code]: errorExample(
      path,
      'Caracteres de control en un dato del titular o en `notes`, o un texto que no es texto',
      INVALID_CHARACTERS.code,
      INVALID_CHARACTERS.message,
    ),
    [NOTES_TOO_LONG.code]: errorExample(
      path,
      '`notes` de más de 500 caracteres',
      NOTES_TOO_LONG.code,
      NOTES_TOO_LONG.message,
    ),
    [ROOM_NOT_AVAILABLE.code]: errorExample(
      path,
      'Una habitación no está disponible en las fechas que quedarían (también si el guardado lo rechaza por solape)',
      ROOM_NOT_AVAILABLE.code,
      ROOM_NOT_AVAILABLE.message('305'),
    ),
    [MAINTENANCE_CHECK_UNAVAILABLE.code]: errorExample(
      path,
      'El Módulo 1 no responde al consultar los mantenimientos',
      MAINTENANCE_CHECK_UNAVAILABLE.code,
      MAINTENANCE_CHECK_UNAVAILABLE.message,
    ),
    [RECALCULATION_UNAVAILABLE.code]: errorExample(
      path,
      'El Módulo 3 no responde al recotizar',
      RECALCULATION_UNAVAILABLE.code,
      RECALCULATION_UNAVAILABLE.message,
    ),
  };
  const rateChanged = {
    [RATE_CHANGED.code]: errorExample(
      path,
      'La tarifa cambió entre la vista previa y la confirmación, o `expectedRates` no coincide con la recotización',
      RATE_CHANGED.code,
      RATE_CHANGED.message,
    ),
  };
  const unexpected = {
    [REQUEST_NOT_PROCESSED]: errorExample(
      path,
      'Una excepción inesperada',
      REQUEST_NOT_PROCESSED,
      REQUEST_NOT_PROCESSED_MESSAGE,
    ),
  };
  return confirmation
    ? { ...examples, ...rateChanged, ...unexpected }
    : { ...examples, ...unexpected };
}

/** Los errores de B1, `POST /api/reservations/{reservationRef}/modification-preview`. */
export const MODIFICATION_PREVIEW_ERROR_EXAMPLES = modificationErrorExamples(
  `/api/reservations/${EXAMPLE_REF}/modification-preview`,
  false,
);

/** Los errores de B2, `PATCH /api/reservations/{reservationRef}`: los de B1 y `RATE_CHANGED`. */
export const MODIFICATION_CONFIRMATION_ERROR_EXAMPLES =
  modificationErrorExamples(`/api/reservations/${EXAMPLE_REF}`, true);

const ASSIGNMENT_PATH = `/api/reservations/${EXAMPLE_REF}/room-assignment`;

/**
 * Los errores `400` de B3, un ejemplo por código y en el orden de los pasos del punto 16: la cabecera
 * `X-User`, la forma del cuerpo, la reserva, `updatedAt`, la habitación de la reserva, la elegida y la
 * disponibilidad.
 */
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
  [INVALID_ROOM_ID.code]: errorExample(
    ASSIGNMENT_PATH,
    '`assignments` fuera de 1 a 10, o un `reservationRoomId` o `roomId` que no es un UUID, o que el Módulo 1 no reconoce',
    INVALID_ROOM_ID.code,
    INVALID_ROOM_ID.message,
  ),
  [ROOM_ALREADY_IN_RESERVATION.code]: errorExample(
    ASSIGNMENT_PATH,
    'Un `roomId` o un `reservationRoomId` repetido en `assignments`',
    ROOM_ALREADY_IN_RESERVATION.code,
    ROOM_ALREADY_IN_RESERVATION.message,
  ),
  [RESERVATION_NOT_FOUND.code]: errorExample(
    ASSIGNMENT_PATH,
    'La reserva no existe',
    RESERVATION_NOT_FOUND.code,
    RESERVATION_NOT_FOUND.message,
  ),
  [RESERVATION_NOT_IN_CONFLICT.code]: errorExample(
    ASSIGNMENT_PATH,
    'La reserva no es de Booking o no está en conflicto',
    RESERVATION_NOT_IN_CONFLICT.code,
    RESERVATION_NOT_IN_CONFLICT.message,
  ),
  [STATUS_NOT_EDITABLE.code]: errorExample(
    ASSIGNMENT_PATH,
    'La reserva de Booking en conflicto no está en `ACTIVE` ni en `PENDING` (se canceló o no se presentó)',
    STATUS_NOT_EDITABLE.code,
    STATUS_NOT_EDITABLE.message,
  ),
  [CONCURRENT_UPDATE.code]: errorExample(
    ASSIGNMENT_PATH,
    '`updatedAt` no coincide (o no viene): otra persona cambió la reserva',
    CONCURRENT_UPDATE.code,
    CONCURRENT_UPDATE.message,
  ),
  [ROOM_ALREADY_ASSIGNED.code]: errorExample(
    ASSIGNMENT_PATH,
    'La habitación de la reserva ya tiene número, o no es de esta reserva',
    ROOM_ALREADY_ASSIGNED.code,
    ROOM_ALREADY_ASSIGNED.message,
  ),
  [INVENTORY_UNAVAILABLE.code]: errorExample(
    ASSIGNMENT_PATH,
    'El Módulo 1 no responde al consultar la habitación elegida',
    INVENTORY_UNAVAILABLE.code,
    INVENTORY_UNAVAILABLE.message,
  ),
  [CATEGORY_MISMATCH.code]: errorExample(
    ASSIGNMENT_PATH,
    'La habitación elegida es de otra categoría',
    CATEGORY_MISMATCH.code,
    CATEGORY_MISMATCH.message,
  ),
  [GUEST_COUNT_EXCEEDS_CAPACITY.code]: errorExample(
    ASSIGNMENT_PATH,
    'La habitación elegida tiene menos capacidad que las personas',
    GUEST_COUNT_EXCEEDS_CAPACITY.code,
    GUEST_COUNT_EXCEEDS_CAPACITY.message,
  ),
  [ROOM_NOT_AVAILABLE.code]: errorExample(
    ASSIGNMENT_PATH,
    'La habitación elegida no está libre en esas fechas (también si el guardado lo rechaza por solape)',
    ROOM_NOT_AVAILABLE.code,
    ROOM_NOT_AVAILABLE.message('204'),
  ),
  [MAINTENANCE_CHECK_UNAVAILABLE.code]: errorExample(
    ASSIGNMENT_PATH,
    'El Módulo 1 no responde al consultar los mantenimientos',
    MAINTENANCE_CHECK_UNAVAILABLE.code,
    MAINTENANCE_CHECK_UNAVAILABLE.message,
  ),
  [REQUEST_NOT_PROCESSED]: errorExample(
    ASSIGNMENT_PATH,
    'Una excepción inesperada',
    REQUEST_NOT_PROCESSED,
    REQUEST_NOT_PROCESSED_MESSAGE,
  ),
};
