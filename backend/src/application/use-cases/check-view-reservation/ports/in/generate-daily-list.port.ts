/** Símbolo con el que Nest inyecta el servicio (plan base, regla 4). */
export const GENERATE_DAILY_LIST = Symbol('GENERATE_DAILY_LIST');

/**
 * Arma y guarda la lista del día para el Módulo 1 (plan de `check-view-reservation`, "Generar la lista del
 * día" y D2). La llaman la tarea de las 00:00 y la recuperación al arrancar (T024).
 */
export interface GenerateDailyList {
  /**
   * Guarda el mensaje `LIST` con la secuencia 1 en `PENDING`, en una sola transacción con el bloqueo de la
   * fila del día. Es idempotente (historia 4, escenario 4).
   * @param operationalDate `AAAA-MM-DD`; por defecto, el día operativo en curso.
   * @returns `true` si generó la lista; `false` si ya estaba generada.
   */
  execute(operationalDate?: string): Promise<boolean>;
}
