import type { CommissionStatus } from '../../../../../domain/shared/enums.js';

/** Símbolo con el que Nest inyecta el servicio. */
export const RECONCILE_COMMISSIONS = Symbol('RECONCILE_COMMISSIONS');

/**
 * Cuántos ítems admite una conciliación (`RECONCILIATION_MAX_ITEMS`, por defecto `500`). Lo usa el controlador
 * para revisar el cuerpo, como `CLOSE_DAY_BATCH_SIZE` en el cierre del día.
 */
export const RECONCILIATION_MAX_ITEMS = Symbol('RECONCILIATION_MAX_ITEMS');

/** A2: lo que el Módulo 3 le indica al Módulo 2. */
export type ReconciliationAction = 'RECONCILED' | 'PAID';

/** Un ítem de A2: la referencia y los importes que el Módulo 3 concilió, como texto decimal y sin moneda. */
export type ReconciliationItem = {
  reservationRef: string;
  grossAmount: string;
  commissionAmount: string;
};

/** Por qué se rechazó un ítem (tabla de `reason` de A2). */
export type ReconciliationRejection =
  | 'RESERVATION_NOT_FOUND'
  | 'NOT_OTA_RESERVATION'
  | 'RESERVATION_CANCELLED'
  | 'RESERVATION_NO_SHOW'
  | 'RESERVATION_NOT_COMPLETED'
  | 'AMOUNT_MISMATCH'
  | 'INVALID_TRANSITION'
  | 'REQUEST_NOT_PROCESSED';

/** El resultado de un ítem. `reason` solo viene con `REJECTED`. */
export type ReconciliationItemResult = {
  reservationRef: string;
  result: 'APPLIED' | 'ALREADY_APPLIED' | 'REJECTED';
  /** El estado de la comisión después del ítem; `null` si la reserva no existe, es directa o falló. */
  commissionStatus: CommissionStatus | null;
  reason: ReconciliationRejection | null;
};

export type ReconciliationOutcome = {
  action: ReconciliationAction;
  results: ReconciliationItemResult[];
  summary: { applied: number; alreadyApplied: number; rejected: number };
};

/**
 * Conciliación de comisiones que pide el Módulo 3 (`register-ota-information-commission`, A2 y C.2; FR-006).
 * La Recepcionista no concilia.
 */
export interface ReconcileCommissions {
  /**
   * Procesa los ítems en el orden recibido, cada uno en su propia transacción: el rechazo o la falla de uno
   * no impide los demás. `items` ya viene revisado por `readReconciliationRequest`.
   *
   * Por cada ítem, el primer caso que se cumple da el resultado: la reserva no existe, es directa, está
   * `CANCELLED`, está `NO_SHOW`, no está `COMPLETED`, los montos no coinciden, ya estaba en `action`
   * (`ALREADY_APPLIED`, sin cambios ni auditoría), la transición no está permitida, o se aplica
   * (`APPLIED`, con su fila en `commission_audit`). Nunca toca la comisión de una reserva cancelada ni en
   * no-show (FR-007).
   *
   * No lanza por un ítem: un error inesperado deja ese ítem `REJECTED` con `REQUEST_NOT_PROCESSED`.
   */
  execute(
    action: ReconciliationAction,
    items: readonly ReconciliationItem[],
  ): Promise<ReconciliationOutcome>;
}
