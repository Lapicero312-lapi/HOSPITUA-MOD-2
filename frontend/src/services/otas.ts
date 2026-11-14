import { apiRequest } from './api-client.ts';

/**
 * La conexión de la agencia con Channex: `DISCONNECTED` cuando Channex rechaza la conexión (spec de
 * `register-ota-information-commission`, FR-008a).
 */
export type OtaConnectionStatus = 'CONNECTED' | 'DISCONNECTED';

/**
 * Una agencia OTA (plan de `register-ota-information-commission`, A3). Las fechas llegan con hora y en
 * hora de Colombia (`2026-10-09T07:58:00-05:00`).
 */
export type Ota = {
  id: string;
  name: string;
  /** De 0 a 100; `null` mientras la agencia no tenga su primera reserva. */
  commissionPercentage: number | null;
  connectionStatus: OtaConnectionStatus;
  linkedAt: string;
  /** La fecha y hora de la última lectura del feed de Channex que terminó bien. */
  lastSyncAt: string;
  /** Las reservas de la agencia en `PENDING`, `ACTIVE` o `IN_PROGRESS`. */
  activeReservations: number;
};

/** La respuesta de `GET /api/otas` (A3). */
export type OtaList = {
  items: Ota[];
  total: number;
};

/**
 * `GET /api/otas` (A3): las agencias, también las desconectadas.
 * @throws ApiError con el error que respondió el backend.
 */
export function listOtas(signal?: AbortSignal): Promise<OtaList> {
  return apiRequest<OtaList>('/otas', { signal });
}
