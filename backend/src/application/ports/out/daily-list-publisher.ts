/** Símbolo con el que Nest inyecta el publicador (plan base, regla 4). */
export const DAILY_LIST_PUBLISHER = Symbol('DAILY_LIST_PUBLISHER');

/** Un mensaje guardado en `daily_list_message`, listo para publicarse tal como está. */
export type PublishableDailyMessage = {
  /** El `messageId` (UUIDv4) del mensaje; es el mismo que lleva el `payload`. */
  messageId: string;
  /** `LIST` es la lista del día; `UPDATE`, una de sus actualizaciones. */
  kind: 'LIST' | 'UPDATE';
  /** El JSON exacto que recibe el Módulo 1. */
  payload: object;
};

/**
 * Publica la lista del día y sus actualizaciones al Módulo 1 (plan de `check-view-reservation`, "Publicar
 * los mensajes"). El orden lo decide `PublishPendingDailyMessages`, que publica de a uno.
 */
export interface DailyListPublisher {
  /**
   * Publica un mensaje y espera la confirmación de RabbitMQ.
   * @throws Error si no hay conexión, si RabbitMQ lo rechaza o si no confirma en 5 s.
   */
  publish(message: PublishableDailyMessage): Promise<void>;
}
