import {
  MessageHandlerErrorBehavior,
  type QueueOptions,
  type RabbitMQConfig,
  type RabbitMQQueueConfig,
} from '@golevelup/nestjs-rabbitmq';
import { Logger } from '@nestjs/common';
import {
  deadLetterQueue,
  EVENTS_EXCHANGE,
  INBOUND_QUEUES,
  type InboundQueueName,
  RETRY_STEPS,
  retryExchange,
  retryQueue,
} from './rabbitmq.topology.js';

/** Una publicación que RabbitMQ no confirma en este tiempo cuenta como fallo (queda `PENDING`). */
export const PUBLISH_CONFIRM_TIMEOUT_MS = 5_000;

/** El exchange por defecto de RabbitMQ: entrega a la cola cuyo nombre es la routing key. */
const DEFAULT_EXCHANGE = '';

/**
 * Los argumentos de una cola de entrada: un mensaje rechazado sin reencolar va a su dead-letter. Los
 * usan la declaración al conectarse y su consumidor, que la declara igual porque la librería prepara
 * los dos a la vez.
 */
export function inboundQueueOptions(queue: InboundQueueName): QueueOptions {
  return {
    durable: true,
    deadLetterExchange: DEFAULT_EXCHANGE,
    deadLetterRoutingKey: deadLetterQueue(queue),
  };
}

/**
 * Lo que el Módulo 2 declara al conectarse (plan base, "Convenciones de colas"). Todo es durable y
 * declararlo otra vez no cambia nada.
 */
function queues(): RabbitMQQueueConfig[] {
  const inbound = Object.values(INBOUND_QUEUES).flatMap((queue) => [
    { name: deadLetterQueue(queue.name), options: { durable: true } },
    {
      name: queue.name,
      exchange: EVENTS_EXCHANGE,
      routingKey: queue.routingKey,
      options: inboundQueueOptions(queue.name),
    },
  ]);
  const retries = RETRY_STEPS.map((step) => ({
    name: retryQueue(step),
    exchange: retryExchange(step),
    routingKey: '',
    // Al vencer la espera, el mensaje vuelve por el exchange por defecto con su routing key: su cola.
    options: {
      durable: true,
      messageTtl: step.delayMs,
      deadLetterExchange: DEFAULT_EXCHANGE,
    },
  }));
  // `m1.reservas.diarias.queue` no se declara: es del Módulo 1, que la declara con su propia dead-letter. La
  // lista del día sale con `mandatory` y, si esa cola aún no existe, vuelve y queda `PENDING`
  // (`RabbitDailyListPublisher`).
  return [...inbound, ...retries];
}

/** Opciones de publicación de `amqp-connection-manager`: `timeout` no está en el tipo de amqplib. */
const defaultPublishOptions = {
  persistent: true,
  timeout: PUBLISH_CONFIRM_TIMEOUT_MS,
};

/**
 * La conexión del Módulo 2 con RabbitMQ. No espera a RabbitMQ para arrancar: las rutas REST funcionan
 * aunque no responda y la conexión se recupera sola. Los consumidores no los registra la librería
 * (esperaría la conexión para terminar de arrancar), sino `InboundConsumersRegistrar`.
 */
export function rabbitMqOptions(uri: string): RabbitMQConfig {
  return {
    uri,
    exchanges: [
      { name: EVENTS_EXCHANGE, type: 'topic', options: { durable: true } },
      ...RETRY_STEPS.map((step) => ({
        name: retryExchange(step),
        type: 'fanout',
        options: { durable: true },
      })),
    ],
    queues: queues(),
    // Un mensaje a la vez por consumidor, para procesarlos en el orden de la cola.
    prefetchCount: 1,
    // Sin manejador propio, un error manda el mensaje a la dead-letter (nunca lo reencola sin fin).
    defaultSubscribeErrorBehavior: MessageHandlerErrorBehavior.NACK,
    defaultPublishOptions,
    connectionInitOptions: { wait: false },
    registerHandlers: false,
    logger: new Logger('RabbitMQ'),
  };
}
