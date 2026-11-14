import type { CommissionStatus } from '../../../domain/shared/enums.js';
import type { Money } from '../../../domain/shared/money.js';
import type { Transaction } from './transaction.js';

/** Símbolo con el que Nest inyecta el repositorio (plan base, regla 4). */
export const COMMISSION_AUDIT_REPOSITORY = Symbol(
  'COMMISSION_AUDIT_REPOSITORY',
);

/**
 * El canal responsable (plan de `register-ota-information-commission`, regla 6): `OTA_API` en el cálculo
 * y `MODULE3` en la conciliación.
 */
export type CommissionAuditChannel = 'OTA_API' | 'MODULE3';

/** Una fila de `commission_audit` (plan base): una comisión calculada o conciliada. */
export type CommissionAuditEntry = {
  reservationId: string;
  otaId: string;
  /** `CALCULATED` en el cálculo; `RECONCILED` o `PAID` en la conciliación. */
  action: CommissionStatus;
  /** El estado de la comisión antes de la acción; vacío en el cálculo. */
  previousStatus: CommissionStatus | null;
  /** Se guarda solo el importe: la tabla no tiene moneda. */
  grossAmount: Money;
  commissionPercentage: string;
  commissionAmount: Money;
  channel: CommissionAuditChannel;
  /** `Booking.com` en el cálculo y `MODULE3` en la conciliación (regla 6). */
  performedBy: string;
};

/**
 * El registro auditable de las comisiones (`register-ota-information-commission`, FR-010 y T004). Cada
 * fila es inmutable: nunca se cambia ni se borra.
 */
export interface CommissionAuditRepository {
  /**
   * Inserta la fila en la transacción de quien llama, con `occurred_at = now()`: si esa transacción se
   * revierte, la fila no queda.
   */
  record(entry: CommissionAuditEntry, tx: Transaction): Promise<void>;

  /**
   * T007: si la reserva ya tiene alguna fila, para que `recordAudit` sepa si es su primera comisión (estado
   * anterior vacío) o una recalculación (`CALCULATED`). Ve las filas aún sin confirmar de `tx`.
   */
  existsFor(reservationId: string, tx: Transaction): Promise<boolean>;
}
