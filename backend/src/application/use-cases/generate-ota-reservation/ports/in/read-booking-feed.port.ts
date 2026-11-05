import type { BookingRevision } from '../../../../integration/booking-revision.js';

/** Símbolo con el que Nest inyecta el servicio en `ChannexSyncJob`. */
export const READ_BOOKING_FEED = Symbol('READ_BOOKING_FEED');

/**
 * El resultado de una lectura del feed. `READ`: todas las páginas respondieron, con las revisiones en el
 * orden del feed (de la más antigua a la más reciente). `NOT_READ`: Channex no respondió bien, así que no
 * se procesa ninguna revisión de esta lectura; siguen sin confirmar y vuelven en la siguiente.
 */
export type BookingFeedRead =
  { status: 'READ'; revisions: BookingRevision[] } | { status: 'NOT_READ' };

/** La lectura del feed de revisiones de Channex (plan, A1 y punto 7). */
export interface ReadBookingFeed {
  /**
   * Pide todas las páginas y actualiza la conexión de la agencia: `markSynced` si todas respondieron, o
   * `markDisconnected` ante un 401 o un 403. Los errores de Channex no salen: dan `NOT_READ`.
   * @throws un error inesperado (por ejemplo, de la base de datos) tal cual.
   */
  read(): Promise<BookingFeedRead>;
}
