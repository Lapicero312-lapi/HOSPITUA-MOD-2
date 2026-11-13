import { BusinessError } from '../../../domain/shared/business-error.js';
import {
  INVALID_CHARACTERS,
  INVALID_RESERVATION_CODE,
} from '../../../domain/shared/error-codes.js';
import {
  CANCELLATION_NOT_CONFIRMED,
  REASON_TOO_LONG,
  RESERVATION_REF_REQUIRED,
} from './error-codes.js';

/** `RSV-` y 8 caracteres hexadecimales en mayúscula (plan base). */
const RESERVATION_REF_FORMAT = /^RSV-[0-9A-F]{8}$/;

const MAX_REASON_LENGTH = 500;

/** Un carácter de control que no es el salto de línea ni la tabulación (como `notes`). */
const CONTROL_CHARACTER = /[^\P{Cc}\n\t]/u;

/**
 * Paso 1 de la regla 3 (plan de `cancel-reservation`, punto 9), antes de consultar la base: la referencia
 * y, después, el motivo, que es opcional.
 * @throws BusinessError `RESERVATION_REF_REQUIRED` si la referencia falta o está vacía,
 * `INVALID_RESERVATION_CODE` si no tiene el formato, `REASON_TOO_LONG` si el motivo pasa de 500 caracteres
 * o `INVALID_CHARACTERS` si trae caracteres de control.
 */
export function checkCancelRequest(
  reservationRef: string | null | undefined,
  reason: string | null | undefined,
): void {
  if (
    reservationRef === null ||
    reservationRef === undefined ||
    reservationRef.trim() === ''
  ) {
    throw new BusinessError(
      RESERVATION_REF_REQUIRED.code,
      RESERVATION_REF_REQUIRED.message,
    );
  }
  if (!RESERVATION_REF_FORMAT.test(reservationRef)) {
    throw new BusinessError(
      INVALID_RESERVATION_CODE.code,
      INVALID_RESERVATION_CODE.message,
    );
  }
  if (reason === null || reason === undefined) {
    return;
  }
  if (reason.length > MAX_REASON_LENGTH) {
    throw new BusinessError(REASON_TOO_LONG.code, REASON_TOO_LONG.message);
  }
  if (CONTROL_CHARACTER.test(reason)) {
    throw new BusinessError(
      INVALID_CHARACTERS.code,
      INVALID_CHARACTERS.message,
    );
  }
}

/**
 * Paso 3 de la regla 3, solo en la cancelación de la Recepcionista (A): la casilla "Entiendo que la
 * cancelación no se puede deshacer" (FR-002b) tiene que llegar marcada.
 * @throws BusinessError `CANCELLATION_NOT_CONFIRMED` si `acknowledged` no es exactamente `true`.
 */
export function checkAcknowledged(acknowledged: unknown): void {
  if (acknowledged !== true) {
    throw new BusinessError(
      CANCELLATION_NOT_CONFIRMED.code,
      CANCELLATION_NOT_CONFIRMED.message,
    );
  }
}

/** El cuerpo de A ya leído, con los tipos que espera `CancelReservation`. */
export type ReceptionCancellationBody = {
  /** Solo `true` exacto confirma: `"true"` o la falta del dato no (paso 3, `CANCELLATION_NOT_CONFIRMED`). */
  acknowledged: boolean;
  /** `undefined` si no vino como texto: entonces no coincide (paso 4, `CONCURRENT_UPDATE`). */
  expectedUpdatedAt: string | undefined;
  reason: string | null;
};

/**
 * El cuerpo de `POST /api/reservations/{reservationRef}/cancellation` (contrato A), sin consultar la base.
 * Solo lee los tipos: las reglas las aplica `CancelReservation`, en el orden de la regla 3. Un motivo que no
 * es texto es `INVALID_CHARACTERS`, pero después de revisar la referencia, que va primero (paso 1).
 * @throws BusinessError `RESERVATION_REF_REQUIRED`, `INVALID_RESERVATION_CODE` o `INVALID_CHARACTERS`.
 */
export function readReceptionCancellationBody(
  reservationRef: string,
  body: unknown,
): ReceptionCancellationBody {
  const fields = isRecord(body) ? body : {};
  const { acknowledged, updatedAt, reason } = fields;
  if (reason !== undefined && reason !== null && typeof reason !== 'string') {
    checkCancelRequest(reservationRef, null);
    throw new BusinessError(
      INVALID_CHARACTERS.code,
      INVALID_CHARACTERS.message,
    );
  }
  return {
    acknowledged: acknowledged === true,
    expectedUpdatedAt: typeof updatedAt === 'string' ? updatedAt : undefined,
    reason: reason ?? null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
