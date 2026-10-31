import type { Transaction } from './transaction.js';

/** Símbolo con el que Nest inyecta el repositorio (plan base, regla 4). */
export const PROCESSED_MESSAGE_REPOSITORY = Symbol(
  'PROCESSED_MESSAGE_REPOSITORY',
);

/** Un mensaje de cola ya atendido: su `messageId` (UUID), la cola de la que llegó y su `sequenceNumber`. */
export type ProcessedMessage = {
  messageId: string;
  queue: string;
  sequenceNumber: number;
};

/**
 * La idempotencia de los consumidores de colas (plan base, "Idempotencia (T014)"). El `messageId` es la
 * única clave de duplicados, en todas las colas. El consumidor valida antes que el `messageId` sea un
 * UUID (si no, el mensaje va a la dead-letter).
 */
export interface ProcessedMessageRepository {
  /** Si el `messageId` ya se atendió. Se llama dentro de la transacción, antes de aplicar el cambio. */
  isProcessed(messageId: string, tx: Transaction): Promise<boolean>;

  /**
   * Registra el mensaje en la misma transacción que el cambio que produce. Si otra entrega del mismo
   * mensaje lo registró a la vez, la clave primaria lo rechaza y la transacción se revierte: el
   * reintento lo encuentra ya procesado.
   */
  record(message: ProcessedMessage, tx: Transaction): Promise<void>;
}
