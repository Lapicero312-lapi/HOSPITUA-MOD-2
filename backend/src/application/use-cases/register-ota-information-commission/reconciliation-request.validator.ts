import { BusinessError } from '../../../domain/shared/business-error.js';
import { INVALID_RESERVATION_CODE } from '../../../domain/shared/error-codes.js';
import {
  INVALID_AMOUNT,
  INVALID_RECONCILIATION_ACTION,
  INVALID_RECONCILIATION_REQUEST,
} from './error-codes.js';
import type {
  ReconciliationAction,
  ReconciliationItem,
} from './ports/in/reconcile-commissions.port.js';

const RESERVATION_REF_FORMAT = /^RSV-[0-9A-F]{8}$/;

/** Un decimal no negativo con hasta dos decimales (`400`, `400.5`, `400.00`), sin signo ni separador de miles. */
const AMOUNT_FORMAT = /^\d+(\.\d{1,2})?$/;

/** El cuerpo de `POST /api/ota-commissions/reconciliations`, ya revisado. */
export type ReconciliationRequest = {
  action: ReconciliationAction;
  items: ReconciliationItem[];
};

/**
 * El cuerpo de A2, revisado antes de procesar ningún ítem (plan de `register-ota-information-commission`,
 * C.2). El primero que falla responde:
 * 1. no es un objeto, o `items` no es una lista, está vacía o tiene más de `maxItems`:
 *    `INVALID_RECONCILIATION_REQUEST`;
 * 2. `action` distinta de `RECONCILED` o `PAID`: `INVALID_RECONCILIATION_ACTION`;
 * 3. por ítem, en orden: `reservationRef` que no es `RSV-` y 8 hexadecimales en mayúscula
 *    (`INVALID_RESERVATION_CODE`; un ítem que no es un objeto no trae referencia) y luego `grossAmount` y
 *    `commissionAmount`, que deben ser texto decimal no negativo con hasta dos decimales (`INVALID_AMOUNT`).
 * @throws BusinessError con el primero que falla.
 */
export function readReconciliationRequest(
  body: unknown,
  maxItems: number,
): ReconciliationRequest {
  const fields = isRecord(body) ? body : {};
  const { action, items } = fields;
  if (!Array.isArray(items) || items.length < 1 || items.length > maxItems) {
    throw error(INVALID_RECONCILIATION_REQUEST);
  }
  if (action !== 'RECONCILED' && action !== 'PAID') {
    throw error(INVALID_RECONCILIATION_ACTION);
  }
  return { action, items: items.map(readItem) };
}

function readItem(entry: unknown): ReconciliationItem {
  const fields = isRecord(entry) ? entry : {};
  const { reservationRef, grossAmount, commissionAmount } = fields;
  if (
    typeof reservationRef !== 'string' ||
    !RESERVATION_REF_FORMAT.test(reservationRef)
  ) {
    throw error(INVALID_RESERVATION_CODE);
  }
  if (!isAmount(grossAmount) || !isAmount(commissionAmount)) {
    throw error(INVALID_AMOUNT);
  }
  return { reservationRef, grossAmount, commissionAmount };
}

function isAmount(value: unknown): value is string {
  return typeof value === 'string' && AMOUNT_FORMAT.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function error(definition: { code: string; message: string }): BusinessError {
  return new BusinessError(definition.code, definition.message);
}
