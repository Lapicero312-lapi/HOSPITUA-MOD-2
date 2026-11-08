import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  PROCESS_CHECK_IN,
  type ProcessCheckIn,
} from '../../../application/use-cases/update-reservation/ports/in/process-check-in.port.js';
import { INBOUND_QUEUES } from '../../config/rabbitmq.topology.js';
import { ConsumesQueue, type InboundConsumer } from './inbound-consumer.js';
import { readRoomNotification } from './room-notification.reader.js';
import { InvalidMessageError } from './retry-or-dead-letter.js';

const QUEUE = INBOUND_QUEUES.CHECK_IN.name;

/**
 * El consumidor de `m2.habitacion.checkin.queue` (plan de `update-reservation`, D3; plan base,
 * "Traducción de respuestas HTTP a cola"):
 * - un mensaje inutilizable deja su motivo en el log, sin datos personales, y va a la dead-letter sin
 *   procesar ni reintentar (`InvalidMessageError`);
 * - uno válido lo procesa `ProcessCheckIn`: aplicado, duplicado o rechazado, se confirma;
 * - un fallo temporal (la base de datos caída) sale como error y se reintenta con espera creciente.
 */
@Injectable()
@ConsumesQueue(QUEUE)
export class CheckInConsumer implements InboundConsumer {
  private readonly logger = new Logger(CheckInConsumer.name);

  constructor(
    @Inject(PROCESS_CHECK_IN)
    private readonly processCheckIn: ProcessCheckIn,
  ) {}

  async handle(message: unknown): Promise<void> {
    let notification;
    try {
      notification = readRoomNotification(message, 'ENTRY');
    } catch (error) {
      if (error instanceof InvalidMessageError) {
        this.logger.warn(`Check-In a la dead-letter: ${error.message}`);
      }
      throw error;
    }
    const { reservationRef, roomId, movementDate, guests } = notification;
    await this.processCheckIn.execute({
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
