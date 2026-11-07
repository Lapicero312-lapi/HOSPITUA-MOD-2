import {
  type GuestNotification,
  readGuestNotification,
  UnusableGuestPayloadError,
} from '../../../application/use-cases/process-guest-data/guest-payload.validator.js';
import type { MovementType } from '../../../domain/shared/enums.js';
import { InvalidMessageError } from './retry-or-dead-letter.js';

/**
 * El mensaje del spec de `update-reservation` (casos borde): la notificación llega vacía, sin la
 * `reservationRef` o sin el `roomId`.
 */
export const MISSING_IDENTIFIERS =
  'El payload de notificación es inválido. Falta el identificador de la reserva o de la habitación.';

/** El de `process-guest-data` para cualquier otro problema de estructura ("Validación de estructura"). */
export const INVALID_PAYLOAD = 'Payload inválido.';

/** UUID en su forma estándar `8-4-4-4-12` (hexadecimal), de cualquier versión. */
const UUID_FORMAT =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Una notificación de Check-In o de Check-Out del contrato A, ya revisada. */
export type RoomNotification = GuestNotification & {
  messageId: string;
  sequenceNumber: number;
};

/**
 * Revisa un mensaje de Check-In o de Check-Out antes de abrir la transacción (plan de `update-reservation`,
 * D3: "Validar estructura del mensaje"; plan de `process-guest-data`, T008: "Rechazo del payload
 * inutilizable antes de registrar"). Es seguridad del payload, no validación de contenido.
 *
 * En este orden, el primero que falla decide el mensaje:
 * 1. vacío, sin `reservationRef` o sin `roomId`: `MISSING_IDENTIFIERS`;
 * 2. la estructura y los caracteres de `readGuestNotification`: "Payload inválido." o "Caracteres no
 *    válidos en los datos de los huéspedes.";
 * 3. `messageId` que no es UUID o `sequenceNumber` que no es un entero de 0 en adelante: "Payload
 *    inválido.".
 * @param movementType `ENTRY` en la cola de Check-In y `DEPARTURE` en la de Check-Out.
 * @throws InvalidMessageError con ese mensaje: el mensaje va a la dead-letter, sin reintentos.
 */
export function readRoomNotification(
  message: unknown,
  movementType: MovementType,
): RoomNotification {
  if (!hasIdentifiers(message)) {
    throw new InvalidMessageError(MISSING_IDENTIFIERS);
  }
  let notification: GuestNotification;
  try {
    notification = readGuestNotification(message, movementType);
  } catch (error) {
    if (error instanceof UnusableGuestPayloadError) {
      throw new InvalidMessageError(error.message);
    }
    throw error;
  }
  const { messageId, sequenceNumber } = message;
  if (
    typeof messageId !== 'string' ||
    !UUID_FORMAT.test(messageId) ||
    typeof sequenceNumber !== 'number' ||
    !Number.isSafeInteger(sequenceNumber) ||
    sequenceNumber < 0
  ) {
    throw new InvalidMessageError(INVALID_PAYLOAD);
  }
  return { ...notification, messageId, sequenceNumber };
}

/** Un objeto con `reservationRef` y `roomId` de texto no vacío. */
function hasIdentifiers(message: unknown): message is Record<
  string,
  unknown
> & {
  reservationRef: string;
  roomId: string;
} {
  if (typeof message !== 'object' || message === null) {
    return false;
  }
  const { reservationRef, roomId } = message as Record<string, unknown>;
  return (
    typeof reservationRef === 'string' &&
    reservationRef !== '' &&
    typeof roomId === 'string' &&
    roomId !== ''
  );
}
