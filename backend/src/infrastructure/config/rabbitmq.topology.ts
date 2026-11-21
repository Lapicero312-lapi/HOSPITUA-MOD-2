/**
 * Nombres de RabbitMQ del Módulo 2 (plan base, "Convenciones de colas"). Los usan la declaración al
 * arrancar, los consumidores (`infrastructure/in/messaging`) y los publicadores
 * (`infrastructure/out/messaging`).
 */

/** Exchange compartido por los módulos (tipo topic). */
export const EVENTS_EXCHANGE = 'hospitua.events';

/**
 * Exchange propio del Módulo 2 (direct): hace lo del exchange por defecto, pero solo para sus colas. Cada
 * cola de entrada y cada dead-letter se une con su propio nombre como routing key, y es el dead-letter
 * exchange de las colas de entrada y de las de reintento. En el broker del Módulo 1 no hay permiso de
 * escritura sobre `amq.default`, que RabbitMQ exige para usar `""` como dead-letter exchange.
 */
export const DIRECT_EXCHANGE = 'm2.direct';

/** Colas que recibe el Módulo 2 (las publica el Módulo 1), con su routing key. */
export const INBOUND_QUEUES = {
  CHECK_IN: {
    name: 'm2.habitacion.checkin.queue',
    routingKey: 'habitacion.checkin',
  },
  CHECK_OUT: {
    name: 'm2.habitacion.checkout.queue',
    routingKey: 'habitacion.checkout',
  },
  MAINTENANCE: {
    name: 'm2.habitacion.mantenimiento.queue',
    routingKey: 'habitacion.mantenimiento',
  },
  INVENTORY: {
    name: 'm2.habitacion.inventario.queue',
    routingKey: 'habitacion.inventario',
  },
} as const;

export type InboundQueue = (typeof INBOUND_QUEUES)[keyof typeof INBOUND_QUEUES];
export type InboundQueueName = InboundQueue['name'];

/** Cola que envía el Módulo 2 (la consume el Módulo 1), con sus dos routing keys. */
export const DAILY_LIST_QUEUE = 'm1.reservas.diarias.queue';
export const DAILY_LIST_ROUTING_KEYS = {
  LIST: 'reserva.lista-del-dia',
  UPDATE: 'reserva.lista-del-dia.actualizacion',
} as const;

/** La dead-letter de una cola de entrada: el mismo nombre terminado en `.dlq`. */
export function deadLetterQueue(queue: InboundQueueName): string {
  return queue.replace(/\.queue$/, '.dlq');
}

/** Cabecera con la cantidad de reintentos que ya tuvo un mensaje. */
export const RETRY_COUNT_HEADER = 'x-retry-count';

/** La espera antes de cada reintento de un consumidor: 5 s, 15 s, 45 s, 2 min y 5 min. */
export const RETRY_STEPS = [
  { label: '5s', delayMs: 5_000 },
  { label: '15s', delayMs: 15_000 },
  { label: '45s', delayMs: 45_000 },
  { label: '2m', delayMs: 120_000 },
  { label: '5m', delayMs: 300_000 },
] as const;

export type RetryStep = (typeof RETRY_STEPS)[number];

/**
 * El exchange (fanout) por el que entra un mensaje a la espera de un reintento. Se publica con la
 * routing key igual al nombre de su cola: al vencer la espera, la cola de espera lo devuelve por el
 * exchange por defecto con esa misma routing key, es decir, a su cola.
 */
export function retryExchange(step: RetryStep): string {
  return `m2.reintento.${step.label}`;
}

/** La cola donde el mensaje espera, sin consumidor, hasta que vence su tiempo. */
export function retryQueue(step: RetryStep): string {
  return `${retryExchange(step)}.queue`;
}
