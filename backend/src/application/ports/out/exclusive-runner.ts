/** Símbolo con el que Nest inyecta el puerto (plan base, regla 4). */
export const EXCLUSIVE_RUNNER = Symbol('EXCLUSIVE_RUNNER');

/**
 * Exclusión mutua entre ejecuciones, también de instancias distintas del Módulo 2 (plan de
 * `check-view-reservation`, "Quién lo llama (T029)"): la usa `PublishPendingDailyMessages` para que dos
 * publicaciones no se crucen y desordenen los mensajes.
 */
export interface ExclusiveRunner {
  /**
   * Ejecuta `work` solo si consigue el bloqueo `name`, y lo suelta al terminar.
   * @returns `false` si otra ejecución tenía el bloqueo; entonces `work` no corre.
   */
  runExclusive(name: string, work: () => Promise<void>): Promise<boolean>;
}
