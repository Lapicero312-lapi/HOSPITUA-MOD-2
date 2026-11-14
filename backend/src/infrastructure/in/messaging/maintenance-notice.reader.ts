import type {
  MaintenanceAction,
  MaintenanceNotice,
} from '../../../application/use-cases/configure-ota/ports/in/handle-maintenance-notice.port.js';
import { InvalidMessageError } from './retry-or-dead-letter.js';

/** UUID en su forma estándar `8-4-4-4-12` (hexadecimal), de cualquier versión. */
const UUID_FORMAT =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;
const ACTIONS: readonly MaintenanceAction[] = [
  'SCHEDULED',
  'UPDATED',
  'CANCELLED',
];

/**
 * Revisa el aviso E1 de `configure-ota` antes de abrir la transacción. "Un mensaje sin `messageId`,
 * `roomId` o `categoryRoom`, con fechas inválidas o con una `action` desconocida va a la dead-letter queue
 * sin procesar" (plan, E). En este orden, el primero que falla decide:
 * 1. `messageId` que no es UUID, o `sequenceNumber` que no es un entero de 0 en adelante;
 * 2. sin `roomId` o sin `categoryRoom` (texto no vacío);
 * 3. `action` que no es `SCHEDULED`, `UPDATED` ni `CANCELLED`;
 * 4. `startDate` o `endDate` que no son una `AAAA-MM-DD` real, o la salida antes que la entrada;
 * 5. con `UPDATED`, lo mismo para `previousStartDate` y `previousEndDate`.
 * @throws InvalidMessageError con el motivo, sin datos del mensaje: va a la dead-letter, sin reintentos.
 */
export function readMaintenanceNotice(
  message: unknown,
  queue: string,
): MaintenanceNotice {
  const fields = asRecord(message);
  const { messageId, sequenceNumber, roomId, categoryRoom, action } = fields;
  if (
    typeof messageId !== 'string' ||
    !UUID_FORMAT.test(messageId) ||
    typeof sequenceNumber !== 'number' ||
    !Number.isSafeInteger(sequenceNumber) ||
    sequenceNumber < 0
  ) {
    throw new InvalidMessageError(
      'Falta el messageId o el sequenceNumber, o no tienen el formato.',
    );
  }
  if (!isText(roomId) || !isText(categoryRoom)) {
    throw new InvalidMessageError('Falta el roomId o el categoryRoom.');
  }
  if (!ACTIONS.includes(action as MaintenanceAction)) {
    throw new InvalidMessageError(
      'La action del mantenimiento es desconocida.',
    );
  }
  const current = readRange(fields.startDate, fields.endDate);
  if (current === null) {
    throw new InvalidMessageError(
      'Las fechas del mantenimiento son inválidas.',
    );
  }
  let previous: MaintenanceNotice['previous'] = null;
  if (action === 'UPDATED') {
    previous = readRange(fields.previousStartDate, fields.previousEndDate);
    if (previous === null) {
      throw new InvalidMessageError(
        'Las fechas anteriores del mantenimiento son inválidas.',
      );
    }
  }
  return {
    messageId,
    sequenceNumber,
    queue,
    action: action as MaintenanceAction,
    roomId: roomId as string,
    categoryRoom: categoryRoom as string,
    startDate: current.startDate,
    endDate: current.endDate,
    previous,
  };
}

/** Dos fechas reales, la segunda no antes que la primera (las dos incluidas). */
function readRange(
  startDate: unknown,
  endDate: unknown,
): { startDate: string; endDate: string } | null {
  if (!isRealDate(startDate) || !isRealDate(endDate) || endDate < startDate) {
    return null;
  }
  return { startDate, endDate };
}

function isRealDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_FORMAT.test(value)) {
    return false;
  }
  const time = Date.parse(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value
  );
}

function isText(value: unknown): boolean {
  return typeof value === 'string' && value.trim() !== '';
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
