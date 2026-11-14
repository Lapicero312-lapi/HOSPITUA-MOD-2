import type { MovementType } from '../../../domain/shared/enums.js';

/**
 * Los dos mensajes de log del plan ("Reglas de validación y manejo de errores", notificaciones de la
 * cola). No llevan datos personales.
 */
const INVALID_PAYLOAD = 'Payload inválido.';
const INVALID_CHARACTERS =
  'Caracteres no válidos en los datos de los huéspedes.';

const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

/** `RSV-` y 8 caracteres hexadecimales en mayúscula (plan base). */
const RESERVATION_REF_FORMAT = /^RSV-[0-9A-F]{8}$/;

/** UUID en su forma estándar `8-4-4-4-12` (hexadecimal), de cualquier versión: el plan no fija una. */
const UUID_FORMAT =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Caracteres de control (`\p{Cc}`), los símbolos `< > { } \ ;` y la secuencia `--`. Los apóstrofes y los
 * guiones sencillos de los nombres sí se permiten.
 */
const FORBIDDEN_CHARACTERS = /[\p{Cc}<>{}\\;]|--/u;

/** Los datos de cada huésped del contrato A. */
const GUEST_FIELDS = [
  'firstName',
  'lastName',
  'documentType',
  'documentNumber',
  'birthDate',
  'nationality',
  'originPlace',
  'destinationPlace',
] as const;

type GuestField = (typeof GUEST_FIELDS)[number];

/**
 * Un huésped tal como llegó. Un dato que falta (o que llega como `null`) no está: este validador no
 * revisa que vengan completos (FR-004); al huésped incompleto lo omite `register` (regla 3).
 */
export type NotifiedGuest = Partial<Record<GuestField, string>>;

/** Una notificación de Check-In o de Check-Out ya revisada (contrato A). */
export type GuestNotification = {
  reservationRef: string;
  roomId: string;
  movementType: MovementType;
  movementDate: string;
  guests: NotifiedGuest[];
};

/**
 * La notificación es inutilizable: no se registra nada y va a la dead-letter queue (FR-010). El
 * `message` es el texto del plan para el log.
 */
export class UnusableGuestPayloadError extends Error {}

/**
 * Revisa la estructura y los caracteres de una notificación de la cola antes de registrar nada (plan,
 * "Validación de estructura"). Es seguridad del payload, no validación de contenido: no revisa si el
 * nombre o el documento son correctos, y no cambia ningún dato (FR-004).
 * @param expectedMovementType `ENTRY` en la cola de Check-In y `DEPARTURE` en la de Check-Out.
 * @throws UnusableGuestPayloadError "Payload inválido." si falta algo o tiene otro formato, y después
 * "Caracteres no válidos en los datos de los huéspedes." si una cadena trae un carácter no permitido.
 */
export function readGuestNotification(
  payload: unknown,
  expectedMovementType: MovementType,
): GuestNotification {
  if (!isRecord(payload)) {
    throw new UnusableGuestPayloadError(INVALID_PAYLOAD);
  }
  const { reservationRef, roomId, movementType, movementDate, guests } =
    payload;
  if (
    typeof reservationRef !== 'string' ||
    !RESERVATION_REF_FORMAT.test(reservationRef) ||
    typeof roomId !== 'string' ||
    !UUID_FORMAT.test(roomId) ||
    movementType !== expectedMovementType ||
    typeof movementDate !== 'string' ||
    !isRealDate(movementDate) ||
    !Array.isArray(guests) ||
    guests.length === 0 ||
    !guests.every(isReadableGuest)
  ) {
    throw new UnusableGuestPayloadError(INVALID_PAYLOAD);
  }
  if (hasForbiddenCharacters(payload)) {
    throw new UnusableGuestPayloadError(INVALID_CHARACTERS);
  }
  return {
    reservationRef,
    roomId,
    movementType: expectedMovementType,
    movementDate,
    guests: guests.map(toNotifiedGuest),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Un objeto cuyos datos, si vienen, son texto. */
function isReadableGuest(guest: unknown): guest is Record<string, unknown> {
  return (
    isRecord(guest) &&
    GUEST_FIELDS.every(
      (field) =>
        guest[field] === undefined ||
        guest[field] === null ||
        typeof guest[field] === 'string',
    )
  );
}

/** Ninguna cadena del payload, en cualquier nivel, trae un carácter no permitido. */
function hasForbiddenCharacters(value: unknown): boolean {
  if (typeof value === 'string') {
    return FORBIDDEN_CHARACTERS.test(value);
  }
  if (Array.isArray(value)) {
    return value.some(hasForbiddenCharacters);
  }
  if (isRecord(value)) {
    return Object.values(value).some(hasForbiddenCharacters);
  }
  return false;
}

/** Los datos del contrato A que vienen como texto, sin cambiarlos. */
function toNotifiedGuest(guest: Record<string, unknown>): NotifiedGuest {
  const notified: NotifiedGuest = {};
  for (const field of GUEST_FIELDS) {
    const value = guest[field];
    if (typeof value === 'string') {
      notified[field] = value;
    }
  }
  return notified;
}

/**
 * La fecha existe en el calendario: con un día o un mes fuera de rango (por ejemplo `2026-13-01`),
 * `Date` no la puede crear; con un día que ese mes no tiene (por ejemplo `2026-02-30`), la corre al mes
 * siguiente y deja de coincidir. Se lee en UTC para que no dependa de la zona horaria del computador.
 */
function isRealDate(value: string): boolean {
  if (!DATE_FORMAT.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}
