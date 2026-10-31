import type { Money } from '../../../../../domain/shared/money.js';

/** Símbolo con el que Nest inyecta el servicio en los demás casos de uso. */
export const REGISTER_OTA_CONFIRMATION_AND_COMMISSION = Symbol(
  'REGISTER_OTA_CONFIRMATION_AND_COMMISSION',
);

export type CommissionInput = {
  otaId: string;
  /** Valor bruto de toda la reserva, recibido de la OTA. */
  grossAmount: Money;
  /** `ota_commission` de la revisión de Channex. */
  reportedCommission: Money | null;
  externalConfirmationCode: string;
};

export type CommissionResult = {
  otaId: string;
  /** El fijo de la agencia, de 0 a 100. */
  commissionPercentage: string;
  /** `true` si se calculó con esta reserva: quien llama lo guarda con `ManageOta.setCommissionPercentage`. */
  learnedPercentage: boolean;
  /** `grossAmount × commissionPercentage / 100`, dos decimales, `ROUND_HALF_UP`. */
  commissionAmount: Money;
  commissionStatus: 'CALCULATED';
};

/**
 * Cálculo de la comisión de una reserva OTA nueva (plan, B1). Lo usa `generate-ota-reservation` dentro de
 * su transacción. `recalculate` y `recordAudit` los agregan sus tareas del plan.
 */
export interface RegisterOtaConfirmationAndCommission {
  /**
   * Valida y calcula; no persiste.
   * @throws BusinessError `OTA_NOT_FOUND`, `COMMISSION_NOT_REPORTED`, `INVALID_COMMISSION_PERCENTAGE` o
   * `DUPLICATE_CONFIRMATION_CODE`.
   */
  calculate(input: CommissionInput): Promise<CommissionResult>;
}
