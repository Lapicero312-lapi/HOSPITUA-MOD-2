/** Símbolo con el que Nest inyecta el servicio. */
export const VERIFY_CHANNEX_PROPERTY = Symbol('VERIFY_CHANNEX_PROPERTY');

/**
 * Cómo quedó la verificación:
 * - `READY`: la propiedad existe y las tareas de Channex pueden trabajar;
 * - `DISABLED`: configuración inválida, propiedad inexistente o Channex respondió 401, 403 u otro 4xx;
 *   apagadas hasta reiniciar;
 * - `RETRY`: Channex no respondió; se vuelve a intentar cada `CHANNEX_SYNC_INTERVAL_SECONDS`.
 */
export type ChannexVerification = 'READY' | 'DISABLED' | 'RETRY';

/** Verificación de la propiedad de Channex con A0 (`configure-ota`, B0). La usa `EnsureChannexSetup`. */
export interface VerifyChannexProperty {
  verify(): Promise<ChannexVerification>;
}
