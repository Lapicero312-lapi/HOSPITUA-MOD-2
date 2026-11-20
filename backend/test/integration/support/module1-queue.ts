import type { Channel } from 'amqplib';
import {
  DAILY_LIST_QUEUE,
  DAILY_LIST_ROUTING_KEYS,
  EVENTS_EXCHANGE,
} from '../../../src/infrastructure/config/rabbitmq.topology.js';

/** La dead-letter que el Módulo 1 le pone a su cola. */
export const MODULE1_DAILY_LIST_DLQ = 'm1.reservas.diarias.dlq';

/**
 * Declara `m1.reservas.diarias.queue` como lo hace el Módulo 1: durable, con su dead-letter y unida a las dos
 * routing keys de la lista del día. El Módulo 2 ya no la declara (plan base, "Convenciones de colas"), así que
 * las pruebas que leen lo que le llega al Módulo 1 la crean primero. Declararla otra vez no cambia nada.
 */
export async function declareModule1Queue(channel: Channel): Promise<void> {
  await channel.assertExchange(EVENTS_EXCHANGE, 'topic', { durable: true });
  await channel.assertQueue(MODULE1_DAILY_LIST_DLQ, { durable: true });
  await channel.assertQueue(DAILY_LIST_QUEUE, {
    durable: true,
    deadLetterExchange: '',
    deadLetterRoutingKey: MODULE1_DAILY_LIST_DLQ,
  });
  for (const routingKey of Object.values(DAILY_LIST_ROUTING_KEYS)) {
    await channel.bindQueue(DAILY_LIST_QUEUE, EVENTS_EXCHANGE, routingKey);
  }
}
