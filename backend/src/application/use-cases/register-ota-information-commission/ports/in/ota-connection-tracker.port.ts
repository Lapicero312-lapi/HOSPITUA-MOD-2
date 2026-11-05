/** Símbolo con el que Nest inyecta el servicio en los demás casos de uso. */
export const OTA_CONNECTION_TRACKER = Symbol('OTA_CONNECTION_TRACKER');

/**
 * El estado de la conexión de la agencia y su última sincronización (plan, B3). Lo llaman
 * `generate-ota-reservation` (cada lectura del feed) y `configure-ota` (si Channex rechaza un envío). No
 * cambia `linkedAt` ni las reservas de la agencia.
 */
export interface OtaConnectionTracker {
  /**
   * Una lectura del feed terminó bien: actualiza `lastSyncAt` y, si estaba `DISCONNECTED`, vuelve a
   * `CONNECTED`.
   * @throws BusinessError `OTA_NOT_FOUND`.
   */
  markSynced(otaId: string, at: Date): Promise<void>;

  /**
   * Channex respondió 401 o 403: pasa a `DISCONNECTED`. No cambia `lastSyncAt`, que es la última lectura
   * que terminó bien.
   * @throws BusinessError `OTA_NOT_FOUND`.
   */
  markDisconnected(otaId: string, at: Date): Promise<void>;
}
