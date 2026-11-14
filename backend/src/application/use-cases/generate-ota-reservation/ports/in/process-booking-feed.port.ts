/** Símbolo con el que Nest inyecta el servicio (plan base, regla 4). */
export const PROCESS_BOOKING_FEED = Symbol('PROCESS_BOOKING_FEED');

/**
 * Un ciclo del feed de Booking (plan de `generate-ota-reservation`, punto 9; T007): repite los `ack`
 * pendientes, lee el feed, procesa las revisiones en orden y confirma las que corresponde. Lo llama
 * `ChannexSyncJob`, con su bloqueo asesor.
 */
export interface ProcessBookingFeed {
  /**
   * Devuelve si leyó el feed: `false` si la lectura dio `NOT_READ` (Channex no respondió bien). Una revisión
   * que falla no cambia el resultado: se deja para el ciclo siguiente, sin lanzar.
   */
  run(): Promise<boolean>;
}
