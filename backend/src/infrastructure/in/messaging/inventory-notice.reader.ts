import type {
  InventoryAction,
  InventoryNotice,
} from '../../../application/use-cases/configure-ota/ports/in/handle-inventory-notice.port.js';
import { InvalidMessageError } from './retry-or-dead-letter.js';

/** UUID en su forma estándar `8-4-4-4-12` (hexadecimal), de cualquier versión. */
const UUID_FORMAT =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIONS: readonly InventoryAction[] = ['ADDED', 'REMOVED', 'UPDATED'];

/**
 * Revisa el aviso E2 de `configure-ota` antes de procesarlo. "Un mensaje sin `messageId`, `roomId` o
 * `categoryRoom` [...] o con una `action` desconocida va a la dead-letter queue sin procesar" (plan, E). En
 * este orden, el primero que falla decide:
 * 1. `messageId` que no es UUID, o `sequenceNumber` que no es un entero de 0 en adelante;
 * 2. sin `roomId` o sin `categoryRoom` (texto no vacío);
 * 3. `action` que no es `ADDED`, `REMOVED` ni `UPDATED`.
 *
 * `previousCategoryRoom` solo viene si la habitación cambió de categoría; si no es un texto no vacío, se
 * toma como que no vino. `maxCapacity` no se usa: la capacidad la lee `SyncRoomTypes` del Módulo 1.
 * @throws InvalidMessageError con el motivo, sin datos del mensaje: va a la dead-letter, sin reintentos.
 */
export function readInventoryNotice(
  message: unknown,
  queue: string,
): InventoryNotice {
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
  if (!ACTIONS.includes(action as InventoryAction)) {
    throw new InvalidMessageError('La action del inventario es desconocida.');
  }
  const { previousCategoryRoom } = fields;
  return {
    messageId,
    sequenceNumber,
    queue,
    action: action as InventoryAction,
    roomId: roomId as string,
    categoryRoom: categoryRoom as string,
    previousCategoryRoom: isText(previousCategoryRoom)
      ? (previousCategoryRoom as string)
      : null,
  };
}

function isText(value: unknown): boolean {
  return typeof value === 'string' && value.trim() !== '';
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
