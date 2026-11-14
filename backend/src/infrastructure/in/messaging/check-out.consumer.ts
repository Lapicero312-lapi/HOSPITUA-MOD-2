import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  PROCESS_CHECK_OUT,
  type ProcessCheckOut,
} from '../../../application/use-cases/update-reservation/ports/in/process-check-out.port.js';
import { INBOUND_QUEUES } from '../../config/rabbitmq.topology.js';
import { ConsumesQueue, type InboundConsumer } from './inbound-consumer.js';
import { readRoomNotification } from './room-notification.reader.js';
import { InvalidMessageError } from './retry-or-dead-letter.js';

const QUEUE = INBOUND_QUEUES.CHECK_OUT.name;

/**
 * El consumidor de `m2.habitacion.checkout.queue` (plan de `update-reservation`, D4; plan base,
 * "Traducción de respuestas HTTP a cola"), igual que `CheckInConsumer` con `DEPARTURE`:
 * - un mensaje inutilizable deja su motivo en el log, sin datos personales, y va a la dead-letter sin
 *   procesar ni reintentar (`InvalidMessageError`);
 * - uno válido lo procesa `ProcessCheckOut`: aplicado, duplicado o rechazado, se confirma;
 * - un fallo temporal (la base de datos caída) sale como error y se reintenta con espera creciente.
 */
@Injectable()
@ConsumesQueue(QUEUE)
export class CheckOutConsumer implements InboundConsumer {
  private readonly logger = new Logger(CheckOutConsumer.name);

  constructor(
    @Inject(PROCESS_CHECK_OUT)
    private readonly processCheckOut: ProcessCheckOut,
  ) {}

  async handle(message: unknown): Promise<void> {
    let notification;
    try {
      notification = readRoomNotification(message, 'DEPARTURE');
    } catch (error) {
      if (error instanceof InvalidMessageError) {
        this.logger.warn(`Check-Out a la dead-letter: ${error.message}`);
      }
      throw error;
    }
    const { reservationRef, roomId, movementDate, guests } = notification;
    await this.processCheckOut.execute({
      messageId: notification.messageId,
      sequenceNumber: notification.sequenceNumber,
      queue: QUEUE,
      reservationRef,
      roomId,
      movementDate,
      guests,
    });
  }
}
