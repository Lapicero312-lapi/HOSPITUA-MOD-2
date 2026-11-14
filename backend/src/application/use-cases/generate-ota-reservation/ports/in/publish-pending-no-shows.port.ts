/** Símbolo con el que Nest inyecta el servicio en `ChannexSyncJob`. */
export const PUBLISH_PENDING_NO_SHOWS = Symbol('PUBLISH_PENDING_NO_SHOWS');

/** Cómo terminó un envío de los reportes pendientes. */
export type NoShowPublication = {
  /** Channex respondió `200`. */
  reported: number;
  /** Channex respondió `404` o `422`: no se vuelven a intentar. */
  rejected: number;
  /** Siguen `PENDING`: no se pudieron enviar o no se llegó a ellos. Se reintentan en el ciclo siguiente. */
  pending: number;
};

/** El envío de los no-shows pendientes a Channex (plan, A3 y punto 8). */
export interface PublishPendingNoShows {
  /** Envía los `PENDING`, del más antiguo al más reciente. Los errores de Channex no salen de aquí. */
  publish(): Promise<NoShowPublication>;
}
