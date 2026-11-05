import type { Ota } from '../../../../../domain/ota/ota.js';
import type { Transaction } from '../../../../ports/out/transaction.js';

/** Símbolo con el que Nest inyecta el servicio en los demás casos de uso. */
export const MANAGE_OTA = Symbol('MANAGE_OTA');

export type OtaRegistration = { name: string };

/**
 * Registro de la agencia y de su porcentaje fijo (plan, B2). `register` lo usa `configure-ota` al iniciar;
 * `setCommissionPercentage`, `generate-ota-reservation` con la primera reserva de la agencia.
 */
export interface ManageOta {
  /**
   * La registra en `CONNECTED` y sin porcentaje, con `linkedAt` y `lastSyncAt` iguales a `at`. Si ya
   * existe una `Ota` con ese `name`, la devuelve sin cambiarla.
   * @throws BusinessError `INVALID_OTA_DATA` si el `name` está vacío.
   */
  register(data: OtaRegistration, at: Date): Promise<Ota>;

  /**
   * Guarda el porcentaje fijo de la agencia, solo si todavía no lo tiene; si ya lo tiene, no lo cambia.
   * @throws BusinessError `OTA_NOT_FOUND` o `INVALID_OTA_DATA` (porcentaje fuera de 0 a 100).
   */
  setCommissionPercentage(
    tx: Transaction,
    otaId: string,
    commissionPercentage: string,
  ): Promise<void>;
}
