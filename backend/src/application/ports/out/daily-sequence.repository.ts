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
   * `null` si no existe: no la crea. Para crearla si falta está `lockOrCreateDay`.
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

  /**
   * Crea la fila del día si no existe (`lastSequence` `0` y `listGenerated` `false`) y la bloquea con
   * `SELECT … FOR UPDATE` hasta que termine `tx` (`GenerateDailyList`, T023). Si dos lo hacen a la vez, la
   * crea uno solo y el otro espera el bloqueo.
   */
  lockOrCreateDay(
    operationalDate: string,
    tx: Transaction,
  ): Promise<DailySequence>;

  /** La lista del día ya quedó guardada: `lastSequence` `1` y `listGenerated` `true` (T023). */
  markListGenerated(operationalDate: string, tx: Transaction): Promise<void>;
}
