import type { RemovalReason } from '../../../domain/reservation/daily-list-membership.js';
import type { Transaction } from './transaction.js';

/** Símbolo con el que Nest inyecta el repositorio (plan base, regla 4). */
export const DAILY_MESSAGE_REPOSITORY = Symbol('DAILY_MESSAGE_REPOSITORY');

/**
 * Un mensaje al Módulo 1, la lista del día o una de sus actualizaciones (plan base, `daily_list_message`).
 * Una `LIST` no lleva tipo, reserva ni motivo; un `UPDATE` lleva tipo y reserva, y el motivo solo, y
 * siempre, en `REMOVED`.
 */
export type DailyMessage = {
  /** El `messageId` (UUIDv4) del mensaje. */
  messageId: string;
  operationalDate: string;
  sequenceNumber: number;
  kind: 'LIST' | 'UPDATE';
  updateType: 'ADDED' | 'UPDATED' | 'REMOVED' | null;
  reservationId: string | null;
  removalReason: RemovalReason | null;
  /** El JSON exacto que se publica. */
  payload: object;
};

/**
 * Los mensajes al Módulo 1, guardados antes de publicarse (`check-view-reservation`, "Anotar un cambio").
 * Los publica `PublishPendingDailyMessages` (T026), en orden de secuencia.
 */
export interface DailyMessageRepository {
  /** Lo inserta en `PENDING`, con `attempts = 0`, en la transacción del cambio que lo generó. */
  insert(message: DailyMessage, tx: Transaction): Promise<void>;
}
