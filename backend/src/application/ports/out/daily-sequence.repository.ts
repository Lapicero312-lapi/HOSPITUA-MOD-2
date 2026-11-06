import type { Transaction } from './transaction.js';

/** Símbolo con el que Nest inyecta el repositorio (plan base, regla 4). */
export const DAILY_SEQUENCE_REPOSITORY = Symbol('DAILY_SEQUENCE_REPOSITORY');

/** La numeración de los avisos de un día operativo (plan base, `daily_sequence`). */
export type DailySequence = {
  /** El último `sequenceNumber` asignado; `0` hasta que sale la lista. */
  lastSequence: number;
  /** `true` cuando la lista del día (secuencia 1) ya quedó guardada. */
  listGenerated: boolean;
};

/**
 * La fila de `daily_sequence` de cada día operativo (`check-view-reservation`, "Anotar un cambio"). Su
 * bloqueo serializa la numeración: ningún cambio queda entre la lista y su primera actualización.
 */
export interface DailySequenceRepository {
  /**
   * `SELECT … FOR UPDATE` de la fila del día (`AAAA-MM-DD`), que queda bloqueada hasta que termine `tx`.
   * `null` si no existe: no la crea, eso lo hace `GenerateDailyList` (T023).
   */
  lockDay(
    operationalDate: string,
    tx: Transaction,
  ): Promise<DailySequence | null>;

  /** Guarda el último `sequenceNumber` asignado del día, en la transacción que lo bloqueó. */
  setLastSequence(
    operationalDate: string,
    lastSequence: number,
    tx: Transaction,
  ): Promise<void>;
}
