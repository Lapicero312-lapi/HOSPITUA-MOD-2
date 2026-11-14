import type { Logger } from '@nestjs/common';
import type { ProcessedMessageRepository } from '../../ports/out/processed-message.repository.js';
import type { Transaction } from '../../ports/out/transaction.js';
import type { RegistrationSummary } from '../process-guest-data/ports/in/register-guest-movements.port.js';
import type { RoomStayNotification } from './ports/in/room-stay-notification.port.js';

/**
 * Los mensajes del log que el Check-In y el Check-Out comparten (spec, casos borde; plan, "Colas (Check-In
 * y Check-Out)"). No llevan datos personales.
 */
export const ROOM_STAY_LOG = {
  RESERVATION_NOT_FOUND:
    'La reserva notificada no existe en el sistema de reservas.',
  ROOM_NOT_IN_RESERVATION:
    'La habitación notificada no pertenece a la reserva.',
} as const;

/**
 * Registra el mensaje en `processed_message`, en la transacción del cambio: el `messageId` para la
 * idempotencia y el `sequenceNumber` para el control de secuencia (T017).
 */
export function recordMessage(
  processedMessages: ProcessedMessageRepository,
  tx: Transaction,
  { messageId, queue, sequenceNumber }: RoomStayNotification,
): Promise<void> {
  return processedMessages.record({ messageId, queue, sequenceNumber }, tx);
}

/**
 * FR-023 (T017): si entre el mayor `sequenceNumber` ya atendido de la cola y este falta alguno, lo advierte
 * y sigue: el Módulo 2 no reordena. Uno anterior o igual, o el primero de la cola, no es un salto.
 */
export async function warnOnSequenceGap(
  processedMessages: ProcessedMessageRepository,
  logger: Logger,
  tx: Transaction,
  { queue, sequenceNumber }: RoomStayNotification,
): Promise<void> {
  const highest = await processedMessages.highestSequenceNumber(queue, tx);
  if (highest !== null && sequenceNumber > highest + 1) {
    logger.warn(
      `Salto de secuencia en ${queue}: se esperaba el ${highest + 1} y llegó el ${sequenceNumber}. Se sigue procesando.`,
    );
  }
}

/** El `RegistrationSummary` para el log (plan de `process-guest-data`, B1): solo cifras. */
export function summaryText(summary: RegistrationSummary): string {
  return `${summary.received} huéspedes recibidos, ${summary.registered} registrados, ${summary.alreadyRegistered} ya registrados, ${summary.foreign} extranjeros y ${summary.skipped} omitidos.`;
}
