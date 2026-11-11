import { checkNotes } from '../../../domain/reservation/reservation-rules.js';
import { BusinessError } from '../../../domain/shared/business-error.js';
import type { DocumentType } from '../../../domain/shared/enums.js';
import {
  GUEST_DATA_REQUIRED,
  INVALID_CHARACTERS,
  INVALID_EMAIL,
  INVALID_GUEST_COUNT,
  INVALID_RESERVATION_DATES,
  INVALID_ROOM_COUNT,
  INVALID_ROOM_ID,
} from '../../../domain/shared/error-codes.js';
import { isValidRoomId } from '../consult-room-inventory/room-id.validator.js';
import { readGuestDocument } from '../generate-direct-reservation/guest-document.validator.js';
import { NATIONALITY_NOT_EDITABLE } from './error-codes.js';

type ErrorCode = { readonly code: string; readonly message: string };

/** `algo@dominio.ext`, sin espacios: la misma forma que en la creación (punto 10 de `generate-direct-reservation`). */
const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Un carácter de control (`\p{Cc}`). */
const CONTROL_CHARACTER = /\p{Cc}/u;
/** Un carácter de control que no es el salto de línea ni la tabulación: los que `notes` admite. */
const CONTROL_CHARACTER_IN_NOTES = /[^\P{Cc}\n\t]/u;

/** Lo que cabe en cada columna de `guest` (migración base), como en la creación; la nacionalidad no cambia. */
const HOLDER_COLUMN_LENGTHS = {
  firstName: 100,
  lastName: 100,
  documentNumber: 30,
  contactPhone: 30,
  contactEmail: 254,
} as const;

/** Una habitación de la lista completa que queda en la reserva: su `roomId`, en minúsculas, y sus personas. */
export type RequestedRoom = { roomId: string; guestCount: number };

/**
 * El cuerpo de cambio de B1 y B2 con la forma ya revisada (regla 7 de la modificación). Un campo en
 * `undefined` no vino: el dato de la reserva queda como está.
 */
export type ModificationRequest = {
  /** El `updatedAt` que leyó la pantalla; `undefined` si no vino como texto, y entonces no coincide (paso 2). */
  expectedUpdatedAt: string | undefined;
  /** El texto tal como llegó: si es una fecha real lo revisa el paso 3. */
  startDate: string | undefined;
  endDate: string | undefined;
  /** La lista completa que pide el cambio; la cantidad, las repetidas y las personas las revisan los pasos 4 y 5. */
  rooms: RequestedRoom[] | undefined;
};

/** El titular corregido: todos sus datos salvo la nacionalidad, que no cambia (regla 6). */
export type HolderCorrection = {
  firstName: string;
  lastName: string;
  documentType: DocumentType;
  documentNumber: string;
  contactPhone: string | null;
  contactEmail: string | null;
};

/** El titular y las observaciones del cambio, revisados en el paso 6. `undefined`: no vino. */
export type HolderAndNotes = {
  guest: HolderCorrection | undefined;
  /** `null` borra las observaciones. */
  notes: string | null | undefined;
};

/**
 * La forma del cuerpo de cambio de B1 y B2, antes del paso 1 de la regla 3 y sin consultar nada (regla 7 de
 * la modificación). Solo revisa los tipos de lo que necesitan los pasos 2 a 5; los valores los revisan esos
 * pasos. El primero que falla da el error.
 * @throws BusinessError `INVALID_RESERVATION_DATES` si una fecha vino y no es texto, `INVALID_ROOM_COUNT` si
 * `rooms` vino y no es una lista, y, en cada habitación en el orden en que llegan, `INVALID_ROOM_ID` si su
 * `roomId` no es un UUID o `INVALID_GUEST_COUNT` si su `guestCount` no es un número entero.
 */
export function readModificationRequest(body: unknown): ModificationRequest {
  const fields = asRecord(body);
  const startDate = readDate(fields.startDate);
  const endDate = readDate(fields.endDate);
  const rooms = readRooms(fields.rooms);
  const { updatedAt } = fields;
  return {
    expectedUpdatedAt: typeof updatedAt === 'string' ? updatedAt : undefined,
    startDate,
    endDate,
    rooms,
  };
}

/**
 * El paso 6 de la regla 3: el titular y las observaciones del cambio de B1 y B2 (regla 7 de la
 * modificación). El primero que falla da el error.
 * @throws BusinessError `NATIONALITY_NOT_EDITABLE` si el titular trae `nationality`; `GUEST_DATA_REQUIRED`,
 * `INVALID_DOCUMENT_TYPE` o `INVALID_CHARACTERS` si el titular no está completo o no es válido;
 * `INVALID_CHARACTERS` o `NOTES_TOO_LONG` por `notes`; e `INVALID_EMAIL` si el correo no tiene su forma.
 */
export function readHolderAndNotes(body: unknown): HolderAndNotes {
  const fields = asRecord(body);
  const guest =
    fields.guest === undefined ? undefined : readHolder(fields.guest);
  const notes = readNotes(fields.notes);
  const email = guest?.contactEmail ?? null;
  if (email !== null && !EMAIL_FORMAT.test(email)) {
    throw errorOf(INVALID_EMAIL);
  }
  return { guest, notes };
}

/** Una fecha que vino tiene que ser texto (también `null` cuenta como fecha vacía). */
function readDate(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw errorOf(INVALID_RESERVATION_DATES);
  }
  return value;
}

/**
 * `rooms`, si vino, es una lista; en cada habitación, primero su `roomId` (un UUID, que queda en minúsculas
 * porque es el mismo escrito de otra forma) y después su `guestCount` (un número entero).
 */
function readRooms(value: unknown): RequestedRoom[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw errorOf(INVALID_ROOM_COUNT);
  }
  return value.map((entry) => {
    const { roomId, guestCount } = asRecord(entry);
    if (typeof roomId !== 'string' || !isValidRoomId(roomId)) {
      throw errorOf(INVALID_ROOM_ID);
    }
    if (typeof guestCount !== 'number' || !Number.isInteger(guestCount)) {
      throw errorOf(INVALID_GUEST_COUNT);
    }
    return { roomId: roomId.toLowerCase(), guestCount };
  });
}

/**
 * El titular corregido: primero que no traiga la nacionalidad (con cualquier valor), después los cuatro datos
 * obligatorios, el documento como en la creación, y los caracteres y el largo de cada texto.
 */
function readHolder(value: unknown): HolderCorrection {
  const guest = asRecord(value);
  if (guest.nationality !== undefined) {
    throw errorOf(NATIONALITY_NOT_EDITABLE);
  }
  const required = ['firstName', 'lastName', 'documentType', 'documentNumber'];
  if (required.some((field) => isBlank(guest[field]))) {
    throw errorOf(GUEST_DATA_REQUIRED);
  }
  const document = readGuestDocument(guest.documentType, guest.documentNumber);
  const texts = {
    firstName: trimmed(guest.firstName),
    lastName: trimmed(guest.lastName),
    documentNumber: document.documentNumber,
    contactPhone: optionalText(guest.contactPhone),
    contactEmail: optionalText(guest.contactEmail),
  };
  for (const [field, text] of Object.entries(texts)) {
    const limit =
      HOLDER_COLUMN_LENGTHS[field as keyof typeof HOLDER_COLUMN_LENGTHS];
    if (
      text !== null &&
      (typeof text !== 'string' ||
        CONTROL_CHARACTER.test(text) ||
        text.length > limit)
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
    contactPhone: texts.contactPhone as string | null,
    contactEmail: texts.contactEmail as string | null,
  };
}

/**
 * `notes`, si vino: `null` borra las observaciones; un texto no puede traer caracteres de control salvo el
 * salto de línea y la tabulación, y después no puede pasar de 500 caracteres.
 */
function readNotes(value: unknown): string | null | undefined {
  if (value === undefined || value === null) {
    return value;
  }
  if (typeof value !== 'string' || CONTROL_CHARACTER_IN_NOTES.test(value)) {
    throw errorOf(INVALID_CHARACTERS);
  }
  checkNotes(value);
  return value;
}

/** Un dato obligatorio que falta o llega vacío (sin contar los espacios de los extremos). */
function isBlank(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === 'string' && value.trim() === '')
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

/** El objeto tal como llega; cualquier otra cosa cuenta como un objeto sin campos. */
function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function errorOf(error: ErrorCode): BusinessError {
  return new BusinessError(error.code, error.message);
}
