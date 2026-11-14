import type { AriChange } from '../../../../ports/out/ari-pending-change.repository.js';
import type { Transaction } from '../../../../ports/out/transaction.js';

/** Símbolo con el que Nest inyecta el puerto en los demás casos de uso (plan base, regla 4). */
export const ARI_CHANGE_RECORDER = Symbol('ARI_CHANGE_RECORDER');

/**
 * Anota los cambios de ocupación para el envío de disponibilidad a Channex (plan de `configure-ota`, B y
 * B2). Lo llaman, dentro de su transacción, `generate-direct-reservation`, `generate-ota-reservation`,
 * `update-reservation` y `cancel-reservation`. El envío lo hace `PublishPendingAvailability` (T010).
 */
export interface AriChangeRecorder {
  /**
   * B2: una marca en `ari_pending_change` por cada categoría y rango de noches afectado (`dateFrom`
   * incluido, `dateTo` excluido: el día de salida no se ocupa), en la transacción `tx` del cambio. Si esa
   * transacción se revierte, las marcas no quedan. Sin cambios, no hace nada.
   */
  record(tx: Transaction, changes: AriChange[]): Promise<void>;
}
