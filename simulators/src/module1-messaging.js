import amqp from 'amqplib';
import {
  DAILY_LIST_QUEUE,
  DAILY_LIST_ROUTING_KEYS,
  EVENTS_EXCHANGE,
  describeDailyListMessage,
} from './module1-messages.js';

/**
 * @typedef {{ publish: (routingKey: string, message: { messageId: string }) => Promise<void>; close: () => Promise<void> }} Module1Publisher
 */

/**
 * La conexión del Módulo 1 simulado con RabbitMQ (plan base, "Simuladores del Módulo 1 y del Módulo 3"):
 * - publica en `hospitua.events` (topic, durable) los avisos de Check-In y Check-Out, persistentes, en JSON
 *   y con `message_id`, y espera la confirmación;
 * - consume `m1.reservas.diarias.queue` (la misma declaración que hace el Módulo 2: durable y unida a sus dos
 *   routing keys) y deja en el log cada mensaje, sin datos de los huéspedes.
 * @param {string} url `RABBITMQ_URL`
 * @param {(line: string) => void} [log]
 * @returns {Promise<Module1Publisher>}
 */
export async function connectModule1Messaging(url, log = console.log) {
  const connection = await amqp.connect(url);
  const channel = await connection.createConfirmChannel();
  await channel.assertExchange(EVENTS_EXCHANGE, 'topic', { durable: true });
  await channel.assertQueue(DAILY_LIST_QUEUE, { durable: true });
  for (const routingKey of DAILY_LIST_ROUTING_KEYS) {
    await channel.bindQueue(DAILY_LIST_QUEUE, EVENTS_EXCHANGE, routingKey);
  }
  await channel.consume(DAILY_LIST_QUEUE, (delivered) => {
    if (delivered === null) {
      return;
    }
    try {
      const payload = JSON.parse(delivered.content.toString('utf8'));
      log(
        `[Módulo 1] ${describeDailyListMessage(delivered.fields.routingKey, payload)}`,
      );
    } catch {
      log('[Módulo 1] Llegó un mensaje de la lista del día que no es JSON.');
    }
    channel.ack(delivered);
  });

  return {
    publish(routingKey, message) {
      return new Promise((resolve, reject) => {
        channel.publish(
          EVENTS_EXCHANGE,
          routingKey,
          Buffer.from(JSON.stringify(message)),
          {
            persistent: true,
            contentType: 'application/json',
            messageId: message.messageId,
          },
          (error) => (error ? reject(error) : resolve()),
        );
      });
    },
    async close() {
      await channel.close();
      await connection.close();
    },
  };
}
