import {
  MessageHandlerErrorBehavior,
  type QueueOptions,
  type RabbitMQConfig,
  type RabbitMQQueueConfig,
} from '@golevelup/nestjs-rabbitmq';
import { Logger } from '@nestjs/common';
import {
  deadLetterQueue,
  DIRECT_EXCHANGE,
  EVENTS_EXCHANGE,
  INBOUND_QUEUES,
  type InboundQueueName,
  RETRY_STEPS,
  retryExchange,
  retryQueue,
} from './rabbitmq.topology.js';

/** Una publicación que RabbitMQ no confirma en este tiempo cuenta como fallo (queda `PENDING`). */
export const PUBLISH_CONFIRM_TIMEOUT_MS = 5_000;

/**
 * Los argumentos de una cola de entrada: un mensaje rechazado sin reencolar va a su dead-letter. Los
 * usan la declaración al conectarse y su consumidor, que la declara igual porque la librería prepara
 * los dos a la vez.
 */
export function inboundQueueOptions(queue: InboundQueueName): QueueOptions {
  return {
    durable: true,
    deadLetterExchange: DIRECT_EXCHANGE,
    deadLetterRoutingKey: deadLetterQueue(queue),
  };
}

/**
 * Lo que el Módulo 2 declara al conectarse (plan base, "Convenciones de colas"). Todo es durable y
 * declararlo otra vez no cambia nada.
 */
function queues(): RabbitMQQueueConfig[] {
  // La misma cola, unida a `m2.direct` con su nombre: se declara otra vez con los mismos argumentos, que no
  // cambia nada, porque la librería une cada cola a un solo exchange.
  const byOwnName = (
    name: string,
    options: QueueOptions,
  ): RabbitMQQueueConfig => ({
    name,
    exchange: DIRECT_EXCHANGE,
    routingKey: name,
    options,
  });
  const inbound = Object.values(INBOUND_QUEUES).flatMap((queue) => [
    byOwnName(deadLetterQueue(queue.name), { durable: true }),
    {
      name: queue.name,
      exchange: EVENTS_EXCHANGE,
      routingKey: queue.routingKey,
      options: inboundQueueOptions(queue.name),
    },
    byOwnName(queue.name, inboundQueueOptions(queue.name)),
  ]);
  const retries = RETRY_STEPS.map((step) => ({
    name: retryQueue(step),
    exchange: retryExchange(step),
    routingKey: '',
    // Al vencer la espera, el mensaje vuelve por `m2.direct` con su routing key, el nombre de su cola.
    options: {
      durable: true,
      messageTtl: step.delayMs,
      deadLetterExchange: DIRECT_EXCHANGE,
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
 *
 * `hospitua.events` es del Módulo 1, que lo crea al arrancar, y en su broker el Módulo 2 no tiene permiso
 * para configurarlo: en producción solo se comprueba que existe (`checkExchange`), sin declararlo (plan
 * base, T022). Si no existiera, RabbitMQ cierra el canal y la conexión no se arma hasta reiniciar el backend.
 * En desarrollo y en las pruebas el broker es el propio, sin Módulo 1: ahí sí se declara.
 */
export function rabbitMqOptions(
  uri: string,
  { declareEventsExchange }: { declareEventsExchange: boolean },
): RabbitMQConfig {
  return {
    uri,
    exchanges: [
      declareEventsExchange
        ? { name: EVENTS_EXCHANGE, type: 'topic', options: { durable: true } }
        : {
            name: EVENTS_EXCHANGE,
            type: 'topic',
            createExchangeIfNotExists: false,
          },
      { name: DIRECT_EXCHANGE, type: 'direct', options: { durable: true } },
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
