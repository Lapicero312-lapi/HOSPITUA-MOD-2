import type { ConnectionStatus } from '../shared/enums.js';

/**
 * Transiciones de `Ota.connectionStatus` (plan de `register-ota-information-commission`: "`CONNECTED`
 * (nace así) ⇄ `DISCONNECTED`, solo por las respuestas de Channex"; spec, FR-008a).
 */
const CONNECTION_TRANSITIONS: Record<
  ConnectionStatus,
  readonly ConnectionStatus[]
> = {
  CONNECTED: ['DISCONNECTED'],
  DISCONNECTED: ['CONNECTED'],
};

/**
 * Si la conexión puede pasar de `from` a `to`. Quedarse en el mismo estado no es una transición: una
 * lectura del feed que termina bien estando `CONNECTED` solo actualiza `lastSyncAt`.
 */
export function canChangeConnectionStatus(
  from: ConnectionStatus,
  to: ConnectionStatus,
): boolean {
  return CONNECTION_TRANSITIONS[from].includes(to);
}
