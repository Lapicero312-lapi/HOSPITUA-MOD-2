import type { Reservation } from '../../../../../domain/reservation/reservation.js';
import type { Transaction } from '../../../../ports/out/transaction.js';

/** Símbolo con el que Nest inyecta el puerto en los demás casos de uso (plan base, regla 4). */
export const DAILY_LIST_CHANGE_RECORDER = Symbol('DAILY_LIST_CHANGE_RECORDER');

/**
 * Anota en la lista del día el cambio de una reserva (plan de `check-view-reservation`, "Anotar un
 * cambio" y D3). Lo llaman, dentro de su transacción, `generate-direct-reservation`,
 * `generate-ota-reservation`, `update-reservation` y `cancel-reservation`.
 */
export interface DailyListChangeRecorder {
  /**
   * Si el cambio afecta la lista de `operationalDate` y la lista ya salió, deja el mensaje `ADDED`,
   * `UPDATED` o `REMOVED` en `PENDING` con la secuencia siguiente, en la misma transacción `tx`.
   * @param before La reserva antes del cambio, o `null` si se acaba de crear.
   * @param after La reserva ya guardada (la que devuelve `insert` o `update` del repositorio), con su
   * `updatedAt` nuevo.
   * @param operationalDate `AAAA-MM-DD`; por defecto, el día operativo en curso. El cierre del día pasa el
   * que acaba de terminar.
   */
  record(
    tx: Transaction,
    before: Reservation | null,
    after: Reservation,
    operationalDate?: string,
  ): Promise<void>;
}
