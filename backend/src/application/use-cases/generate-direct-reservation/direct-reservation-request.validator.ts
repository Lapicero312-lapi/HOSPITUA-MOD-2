import {
  checkNotes,
  checkStayDates,
} from '../../../domain/reservation/reservation-rules.js';
import { BusinessError } from '../../../domain/shared/business-error.js';
import type { DocumentType } from '../../../domain/shared/enums.js';
import {
  GUEST_COUNT_TOO_LOW,
  GUEST_DATA_REQUIRED,
  INVALID_CATEGORY,
  INVALID_CHARACTERS,
  INVALID_EMAIL,
  INVALID_GUEST_COUNT,
  INVALID_RESERVATION_DATES,
  INVALID_ROOM_COUNT,
  INVALID_ROOM_ID,
  RATE_CHANGED,
  ROOM_ALREADY_IN_RESERVATION,
} from '../../../domain/shared/error-codes.js';
import { isValidCategoryRoom } from '../consult-room-inventory/category-room.validator.js';
import { isValidRoomId } from '../consult-room-inventory/room-id.validator.js';
import { readGuestDocument } from './guest-document.validator.js';

type ErrorCode = { readonly code: string; readonly message: string };

const MAX_ROOMS = 10;
/** Un decimal positivo con dos decimales, como lo muestra la cotización (`"750000.00"`). */
const AMOUNT_FORMAT = /^\d+\.\d{2}$/;
/** Una moneda: 3 letras mayúsculas (`COP`), con la que `verifyQuotes` compara. */
const CURRENCY_FORMAT = /^[A-Z]{3}$/;
/** `algo@dominio.ext`, sin espacios (punto 10). */
const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Un carácter de control (`\p{Cc}`). */
const CONTROL_CHARACTER = /\p{Cc}/u;
/** Un carácter de control que no es el salto de línea ni la tabulación: los que `notes` admite. */
const CONTROL_CHARACTER_IN_NOTES = /[^\P{Cc}\n\t]/u;

/**
 * Lo que cabe en cada columna de `guest` (migración base). El punto 10 lista los cuatro primeros; el
 * número de documento cae en la misma regla ("cuando no cabe en su columna").
 */
const GUEST_COLUMN_LENGTHS = {
  firstName: 100,
  lastName: 100,
  nationality: 60,
  contactPhone: 30,
  contactEmail: 254,
  documentNumber: 30,
} as const;

/** Una habitación pedida: su `guestCount` y, si la Recepcionista la eligió, su `roomId`. */
export type RequestedRoom = { guestCount: number; roomId: string | null };

/** La solicitud de la vista previa (A), ya revisada. */
export type DirectReservationRequest = {
  startDate: string;
  endDate: string;
  categoryRoom: string;
  rooms: RequestedRoom[];
};

/** El titular de la creación, sin los espacios de los extremos; teléfono y correo vacíos quedan en `null`. */
export type RequestedGuest = {
  firstName: string;
  lastName: string;
  documentType: DocumentType;
  documentNumber: string;
  nationality: string;
  contactPhone: string | null;
  contactEmail: string | null;
};

/** La tarifa que vio el solicitante para una habitación, por su posición (B): el valor y su moneda. */
export type ExpectedRate = {
  position: number;
  lodgingAmount: string;
  currency: string;
};

/** La solicitud de la creación (B), ya revisada. */
export type DirectReservationCreation = DirectReservationRequest & {
  guest: RequestedGuest;
  notes: string | null;
  expectedRates: ExpectedRate[];
};

/**
 * Revisa la solicitud de la vista previa (`POST /api/reservations/direct/preview`, A): los pasos 1 a 3 de
 * la regla 2 en el orden del punto 10, antes de consultar la disponibilidad. La vista previa no trae
 * titular, observaciones ni tarifas.
 * @param operationalDate El día operativo del `Clock` (`AAAA-MM-DD`): la entrada no puede ser anterior.
 * @throws BusinessError con el código y el mensaje de la tabla C.
 */
export function readPreviewRequest(
  body: unknown,
  operationalDate: string,
): DirectReservationRequest {
  const fields = asRecord(body);
  checkFormats(fields, false);
  return checkRoomsAndDates(fields, operationalDate);
}

/**
 * Revisa la solicitud de la creación (`POST /api/reservations/direct`, B): los pasos 1 a 4 de la regla 2
 * en el orden del punto 10, antes de consultar la disponibilidad. El primero que falla da el error.
 * @param operationalDate El día operativo del `Clock` (`AAAA-MM-DD`): la entrada no puede ser anterior.
 * @throws BusinessError con el código y el mensaje de la tabla C.
 */
export function readCreationRequest(
  body: unknown,
  operationalDate: string,
): DirectReservationCreation {
  const fields = asRecord(body);
  const expectedRates = checkFormats(fields, true);
  const request = checkRoomsAndDates(fields, operationalDate);
  const notes = readNotesLength(fields.notes);
  const guest = readGuest(fields.guest);
  checkNotesCharacters(fields.notes);
  if (guest.contactEmail !== null && !EMAIL_FORMAT.test(guest.contactEmail)) {
    throw errorOf(INVALID_EMAIL);
  }
  return { ...request, guest, notes, expectedRates };
}

/**
 * Paso 1, formatos: la categoría, cada `roomId` que venga y, solo en la creación, `expectedRates`.
 * @returns Las tarifas esperadas (vacía en la vista previa).
 */
function checkFormats(
  fields: Record<string, unknown>,
  withExpectedRates: boolean,
): ExpectedRate[] {
  const { categoryRoom, rooms } = fields;
  if (typeof categoryRoom !== 'string' || !isValidCategoryRoom(categoryRoom)) {
    throw errorOf(INVALID_CATEGORY);
  }
  if (Array.isArray(rooms)) {
    for (const room of rooms) {
      const roomId = asRecord(room).roomId;
      if (
        isPresent(roomId) &&
        (typeof roomId !== 'string' || !isValidRoomId(roomId))
      ) {
        throw errorOf(INVALID_ROOM_ID);
      }
    }
  }
  if (!withExpectedRates) {
    return [];
  }
  // Una entrada por habitación: si `rooms` no es una lista, su cantidad la revisa el paso 2.
  const roomCount = Array.isArray(rooms) ? rooms.length : undefined;
  return readExpectedRates(fields.expectedRates, roomCount);
}

/**
 * `expectedRates`: una entrada por habitación, con `position` de 1 a n sin repetir y `lodgingAmount` como
 * decimal positivo de dos decimales y `currency` de 3 letras mayúsculas. Si no, `RATE_CHANGED`: la pantalla vuelve a cotizar.
 */
function readExpectedRates(
  value: unknown,
  roomCount: number | undefined,
): ExpectedRate[] {
  if (
    !Array.isArray(value) ||
    (roomCount !== undefined && value.length !== roomCount)
  ) {
    throw errorOf(RATE_CHANGED);
  }
  const positions = new Set<number>();
  const rates = value.map((entry): ExpectedRate => {
    const { position, lodgingAmount, currency } = asRecord(entry);
    if (
      typeof position !== 'number' ||
      !Number.isInteger(position) ||
      position < 1 ||
      position > value.length ||
      positions.has(position) ||
      typeof lodgingAmount !== 'string' ||
      !AMOUNT_FORMAT.test(lodgingAmount) ||
      Number(lodgingAmount) <= 0 ||
      typeof currency !== 'string' ||
      !CURRENCY_FORMAT.test(currency)
    ) {
      throw errorOf(RATE_CHANGED);
    }
    positions.add(position);
    return { position, lodgingAmount, currency };
  });
  return rates;
}

/** Pasos 2 y 3: las habitaciones y después las fechas. */
function checkRoomsAndDates(
  fields: Record<string, unknown>,
  operationalDate: string,
): DirectReservationRequest {
  const rooms = readRooms(fields.rooms);
  const { startDate, endDate } = fields;
  if (typeof startDate !== 'string' || typeof endDate !== 'string') {
    throw errorOf(INVALID_RESERVATION_DATES);
  }
  checkStayDates(startDate, endDate, operationalDate);
  // Ya revisado en el paso 1.
  return {
    startDate,
    endDate,
    categoryRoom: fields.categoryRoom as string,
    rooms,
  };
}

/**
 * Paso 2: de 1 a 10 habitaciones, sin repetir un `roomId`, y cada `guestCount` entero mayor que cero (en
 * el orden en que llegan). Un `roomId` se compara sin distinguir mayúsculas: es el mismo UUID.
 */
function readRooms(value: unknown): RequestedRoom[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ROOMS) {
    throw errorOf(INVALID_ROOM_COUNT);
  }
  const entries = value.map(asRecord);
  const roomIds = entries
    .map(({ roomId }) => roomId)
    .filter(isPresent)
    .map((roomId) => (roomId as string).toLowerCase());
  if (new Set(roomIds).size !== roomIds.length) {
    throw errorOf(ROOM_ALREADY_IN_RESERVATION);
  }
  return entries.map(({ guestCount, roomId }) => {
    if (guestCount === 0) {
      throw errorOf(GUEST_COUNT_TOO_LOW);
    }
    if (
      typeof guestCount !== 'number' ||
      !Number.isInteger(guestCount) ||
      guestCount < 0
    ) {
      throw errorOf(INVALID_GUEST_COUNT);
    }
    return {
      guestCount,
      roomId: isPresent(roomId) ? (roomId as string) : null,
    };
  });
}

/** Paso 4, primero: `notes` es opcional (`null` o ausente) y tiene como máximo 500 caracteres. */
function readNotesLength(value: unknown): string | null {
  if (!isPresent(value)) {
    return null;
  }
  if (typeof value === 'string') {
    checkNotes(value);
    return value;
  }
  // Otro tipo: lo rechaza la revisión de caracteres, en su lugar del orden.
  return null;
}

/** Paso 4, al final: `notes` es texto, sin caracteres de control salvo el salto de línea y la tabulación. */
function checkNotesCharacters(value: unknown): void {
  if (
    isPresent(value) &&
    (typeof value !== 'string' || CONTROL_CHARACTER_IN_NOTES.test(value))
  ) {
    throw errorOf(INVALID_CHARACTERS);
  }
}

/**
 * Paso 4, el titular: los cinco datos obligatorios, el documento (punto 9) y los caracteres y el largo de
 * cada texto. El correo se revisa después de los caracteres de `notes`, como en el punto 10.
 */
function readGuest(value: unknown): RequestedGuest {
  const guest = asRecord(value);
  const required = [
    'firstName',
    'lastName',
    'documentType',
    'documentNumber',
    'nationality',
  ];
  if (required.some((field) => isBlank(guest[field]))) {
    throw errorOf(GUEST_DATA_REQUIRED);
  }
  const document = readGuestDocument(guest.documentType, guest.documentNumber);
  const texts = {
    firstName: trimmed(guest.firstName),
    lastName: trimmed(guest.lastName),
    nationality: trimmed(guest.nationality),
    contactPhone: optionalText(guest.contactPhone),
    contactEmail: optionalText(guest.contactEmail),
    documentNumber: document.documentNumber,
  };
  for (const [field, text] of Object.entries(texts)) {
    const fits = (limit: number) =>
      typeof text === 'string' && text.length <= limit;
    if (
      text !== null &&
      (typeof text !== 'string' ||
        CONTROL_CHARACTER.test(text) ||
        !fits(GUEST_COLUMN_LENGTHS[field as keyof typeof GUEST_COLUMN_LENGTHS]))
    ) {
      throw errorOf(INVALID_CHARACTERS);
    }
  }
  // Ya revisados: los obligatorios son texto no vacío y los opcionales, texto o null.
  return {
    firstName: texts.firstName as string,
    lastName: texts.lastName as string,
    documentType: document.documentType,
    documentNumber: document.documentNumber,
    nationality: texts.nationality as string,
    contactPhone: texts.contactPhone as string | null,
    contactEmail: texts.contactEmail as string | null,
  };
}

/** Un dato obligatorio que falta o llega vacío (sin contar los espacios de los extremos). */
function isBlank(value: unknown): boolean {
  return (
    !isPresent(value) || (typeof value === 'string' && value.trim() === '')
  );
}

/** Un texto opcional: sin los espacios de los extremos, y `null` si no viene o queda vacío. */
function optionalText(value: unknown): unknown {
  const text = trimmed(value);
  return text === undefined || text === null || text === '' ? null : text;
}

function trimmed(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

/** Un campo opcional cuenta como presente si no es `undefined` ni `null`. */
function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null;
}

/** El objeto tal como llega; cualquier otra cosa cuenta como un objeto sin campos. */
function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function errorOf(error: ErrorCode): BusinessError {
  return new BusinessError(error.code, error.message);
}
