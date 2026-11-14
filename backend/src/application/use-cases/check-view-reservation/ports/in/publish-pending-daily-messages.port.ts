/** Símbolo con el que Nest inyecta el servicio (plan base, regla 4). */
export const PUBLISH_PENDING_DAILY_MESSAGES = Symbol(
  'PUBLISH_PENDING_DAILY_MESSAGES',
);

/**
 * Publica al Módulo 1 los mensajes de la lista del día que siguen pendientes, en orden de secuencia (plan
 * de `check-view-reservation`, "Publicación en orden" y "Publicar los mensajes", T026). Lo llaman la tarea
 * de cada 10 s y la publicación inmediata después de confirmar (T029).
 */
export interface PublishPendingDailyMessages {
  /**
   * Publica en orden los mensajes pendientes que ya pueden salir. Un error de la publicación no se
   * propaga: queda en el log y en los intentos del mensaje (FR-020).
   * @returns Cuántos publicó.
   */
  execute(): Promise<number>;
}
