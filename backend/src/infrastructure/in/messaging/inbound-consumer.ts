import { DiscoveryService } from '@nestjs/core';
import type { InboundQueueName } from '../../config/rabbitmq.topology.js';

/**
 * Un consumidor de una cola de entrada. `handle` recibe el mensaje ya leído como JSON:
 * - si termina, el mensaje se confirma (también cuando el caso de uso lo rechaza y solo lo registra);
 * - si lanza `InvalidMessageError`, va a la dead-letter;
 * - si lanza otro error, se reintenta (ver `retryOrDeadLetter`).
 */
export interface InboundConsumer {
  handle(message: unknown): Promise<void>;
}

/**
 * Marca la clase que consume una cola de entrada: `@ConsumesQueue(INBOUND_QUEUES.CHECK_IN.name)`. La
 * clase implementa `InboundConsumer` y se declara como proveedor de su módulo.
 */
export const ConsumesQueue =
  DiscoveryService.createDecorator<InboundQueueName>();
