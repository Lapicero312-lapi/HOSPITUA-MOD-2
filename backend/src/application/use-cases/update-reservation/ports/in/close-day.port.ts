/** Símbolo con el que Nest inyecta el servicio en `CloseDayJob` (plan base, regla 4). */
export const CLOSE_DAY = Symbol('CLOSE_DAY');

/** Cuántas reservas se procesan en cada lote (`CLOSE_DAY_BATCH_SIZE`, por defecto `100`). */
export const CLOSE_DAY_BATCH_SIZE = Symbol('CLOSE_DAY_BATCH_SIZE');

/** Qué pasó con las reservas del día cerrado (plan, D5 y punto 13). Solo cifras: nada personal. */
export type CloseDaySummary = {
  /** El día operativo cerrado, `AAAA-MM-DD`. */
  operationalDate: string;
  /** `ACTIVE` o `PENDING` que pasaron a `NO_SHOW`. */
  noShow: number;
  /** `IN_PROGRESS` con habitaciones que pasaron a `NOT_ARRIVED` y siguen `IN_PROGRESS`. */
  notArrived: number;
  /** `IN_PROGRESS` con habitaciones que pasaron a `NOT_ARRIVED` y quedaron `COMPLETED`. */
  completed: number;
  /** Todo el grupo ingresó, o la reserva cambió entre la selección y el bloqueo. */
  ignored: number;
  /** Su transacción se revirtió y quedó una advertencia en el log (FR-022). */
  failed: number;
};

/**
 * El cierre del día operativo (plan, "Cierre del día", D5 y punto 13; FR-018 a FR-022). Una transacción por
 * reserva: una que falla no detiene a las demás. Es idempotente (NFR-003): lo ya cerrado sale de la
 * selección o se ignora.
 */
export interface CloseDay {
  /**
   * Cierra las reservas que llegaban `operationalDate` (el día que terminó, `AAAA-MM-DD`). No lanza por una
   * reserva: la cuenta en `failed`.
   * @throws Error si falla la selección de un lote (la base de datos no responde): el cierre se detiene sin
   * dejar ninguna reserva a medias.
   */
  execute(operationalDate: string): Promise<CloseDaySummary>;

  /**
   * Cierra, del más antiguo al más reciente, cada día operativo anterior a `today` (`AAAA-MM-DD`) que
   * todavía tiene algo que cerrar (plan, punto 14; T022). Así la recuperación completa los días que no se
   * cerraron, también si el servidor estuvo apagado varios días o un cierre se detuvo por la base de datos.
   * El día `today` nunca se cierra.
   * @returns El resumen de cada día cerrado, en orden; vacío si no había ninguno pendiente.
   * @throws Error si falla una selección: se detiene en ese día y no sigue con los siguientes.
   */
  closePendingDays(today: string): Promise<CloseDaySummary[]>;
}
