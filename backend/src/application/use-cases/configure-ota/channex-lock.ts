/**
 * El bloqueo asesor de las tareas de Channex (plan de `configure-ota`, regla 7, y de `generate-ota-reservation`,
 * punto 7). Lo comparten `ChannexSyncJob`, `AriDailyJob` y el aviso E2 (`HandleInventoryNotice`), para que
 * nunca sincronicen ni envíen a la vez.
 */
export const CHANNEX_LOCK = 'channex-sync';
