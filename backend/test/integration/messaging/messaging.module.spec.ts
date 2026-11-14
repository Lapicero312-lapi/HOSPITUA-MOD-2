import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { Injectable } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  inject,
  it,
  vi,
} from 'vitest';
import { MessagingModule } from '../../../src/infrastructure/config/messaging.module.js';
import {
  DAILY_LIST_QUEUE,
  DAILY_LIST_ROUTING_KEYS,
  deadLetterQueue,
  EVENTS_EXCHANGE,
  INBOUND_QUEUES,
  RETRY_STEPS,
  retryQueue,
} from '../../../src/infrastructure/config/rabbitmq.topology.js';
import {
  ConsumesQueue,
  type InboundConsumer,
} from '../../../src/infrastructure/in/messaging/inbound-consumer.js';
import { InvalidMessageError } from '../../../src/infrastructure/in/messaging/retry-or-dead-letter.js';
import { integrationEnv } from '../support/database.js';

const CHECK_IN = INBOUND_QUEUES.CHECK_IN;

/** Lo que recibe el consumidor de prueba y qué hace con cada mensaje. */
const deliveries: { message: unknown; at: number }[] = [];
let behavior: (message: unknown) => Promise<void> = () => Promise.resolve();

@Injectable()
@ConsumesQueue(CHECK_IN.name)
class ProbeConsumer implements InboundConsumer {
  handle(message: unknown): Promise<void> {
    deliveries.push({ message, at: Date.now() });
    return behavior(message);
  }
}

async function startMessaging(url: string): Promise<TestingModule> {
  process.env.RABBITMQ_URL = url;
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
      MessagingModule,
    ],
    providers: [ProbeConsumer],
  }).compile();
  // Los errores esperados de los consumidores no ensucian la salida de las pruebas.
  moduleRef.useLogger(false);
  return moduleRef.init();
}

/** La API del panel de RabbitMQ, con las credenciales de `RABBITMQ_URL`. */
async function management<T>(path: string): Promise<T> {
  const url = new URL(integrationEnv().RABBITMQ_URL);
  const credentials = Buffer.from(
    `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`,
  ).toString('base64');
  const response = await fetch(
    `${inject('rabbitmqManagementUrl')}/api${path}`,
    {
      headers: { Authorization: `Basic ${credentials}` },
    },
  );
  return (await response.json()) as T;
}

const ALL_QUEUES = [
  ...Object.values(INBOUND_QUEUES).flatMap((q) => [
    q.name,
    deadLetterQueue(q.name),
  ]),
  ...RETRY_STEPS.map(retryQueue),
  DAILY_LIST_QUEUE,
];

describe('MessagingModule', () => {
  let moduleRef: TestingModule;
  let connection: AmqpConnection;

  const messageCount = async (queue: string) =>
    (await connection.channel.checkQueue(queue)).messageCount;

  beforeAll(async () => {
    moduleRef = await startMessaging(integrationEnv().RABBITMQ_URL);
    connection = moduleRef.get(AmqpConnection);
    // El consumidor se suscribe cuando hay conexión, sin que el arranque lo espere.
    await vi.waitFor(
      async () =>
        expect(
          (await connection.channel.checkQueue(CHECK_IN.name)).consumerCount,
        ).toBe(1),
      { timeout: 15_000, interval: 100 },
    );
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  beforeEach(async () => {
    deliveries.length = 0;
    behavior = () => Promise.resolve();
    for (const queue of ALL_QUEUES) {
      await connection.channel.purgeQueue(queue);
    }
  });

  it('declara las colas de entrada con su dead-letter, las esperas y la cola del Módulo 1', async () => {
    const checkIn = await management<{ arguments: Record<string, unknown> }>(
      `/queues/%2F/${CHECK_IN.name}`,
    );
    // RabbitMQ 4 agrega el tipo de cola (classic) por su cuenta.
    expect(checkIn.arguments).toMatchObject({
      'x-dead-letter-exchange': '',
      'x-dead-letter-routing-key': 'm2.habitacion.checkin.dlq',
    });

    const wait = await management<{ arguments: Record<string, unknown> }>(
      '/queues/%2F/m2.reintento.2m.queue',
    );
    expect(wait.arguments).toMatchObject({
      'x-dead-letter-exchange': '',
      'x-message-ttl': 120_000,
    });

    const bindings = await management<
      { source: string; routing_key: string }[]
    >(`/queues/%2F/${DAILY_LIST_QUEUE}/bindings`);
    expect(
      bindings
        .filter((b) => b.source === EVENTS_EXCHANGE)
        .map((b) => b.routing_key)
        .sort(),
    ).toEqual(['reserva.lista-del-dia', 'reserva.lista-del-dia.actualizacion']);
  });

  it('entrega un mensaje de su routing key al consumidor y lo confirma', async () => {
    await connection.publish(EVENTS_EXCHANGE, CHECK_IN.routingKey, {
      messageId: 'm-1',
    });

    await vi.waitFor(() => expect(deliveries).toHaveLength(1));
    expect(deliveries[0].message).toEqual({ messageId: 'm-1' });
    await vi.waitFor(async () =>
      expect(await messageCount(CHECK_IN.name)).toBe(0),
    );
    expect(await messageCount(deadLetterQueue(CHECK_IN.name))).toBe(0);
  });

  it('un payload que no es JSON va a la dead-letter sin llegar al consumidor', async () => {
    await connection.publish(
      EVENTS_EXCHANGE,
      CHECK_IN.routingKey,
      Buffer.from('no es json'),
    );

    await vi.waitFor(async () =>
      expect(await messageCount(deadLetterQueue(CHECK_IN.name))).toBe(1),
    );
    expect(deliveries).toHaveLength(0);
  });

  it('un mensaje que el consumidor rechaza por inválido va a la dead-letter sin reintentos', async () => {
    behavior = () => Promise.reject(new InvalidMessageError('Sin roomId'));

    await connection.publish(EVENTS_EXCHANGE, CHECK_IN.routingKey, {
      messageId: 'm-2',
    });

    await vi.waitFor(async () =>
      expect(await messageCount(deadLetterQueue(CHECK_IN.name))).toBe(1),
    );
    expect(deliveries).toHaveLength(1);
    expect(await messageCount(retryQueue(RETRY_STEPS[0]))).toBe(0);
  });

  it('un fallo temporal se reintenta a los 5 s con x-retry-count 1', async () => {
    let failures = 1;
    behavior = () =>
      failures-- > 0
        ? Promise.reject(new Error('base caída'))
        : Promise.resolve();

    await connection.publish(EVENTS_EXCHANGE, CHECK_IN.routingKey, {
      messageId: 'm-3',
    });

    await vi.waitFor(() => expect(deliveries).toHaveLength(2), {
      timeout: 15_000,
      interval: 100,
    });
    expect(deliveries[1].message).toEqual({ messageId: 'm-3' });
    expect(deliveries[1].at - deliveries[0].at).toBeGreaterThanOrEqual(4_500);
    await vi.waitFor(async () =>
      expect(await messageCount(CHECK_IN.name)).toBe(0),
    );
    expect(await messageCount(deadLetterQueue(CHECK_IN.name))).toBe(0);
  });

  it('el mensaje espera su reintento persistente, con x-retry-count 1 y la routing key de su cola', async () => {
    // La cola de espera no tiene consumidor: el mensaje se lee antes de que venzan los 5 s.
    behavior = () => Promise.reject(new Error('base caída'));
    await connection.publish(EVENTS_EXCHANGE, CHECK_IN.routingKey, {
      messageId: 'm-4',
    });
    await vi.waitFor(async () =>
      expect(await messageCount(retryQueue(RETRY_STEPS[0]))).toBe(1),
    );

    const waiting = await connection.channel.get(retryQueue(RETRY_STEPS[0]));
    expect(waiting && waiting.properties.headers?.['x-retry-count']).toBe(1);
    expect(waiting && waiting.fields.routingKey).toBe(CHECK_IN.name);
    expect(waiting && waiting.properties.deliveryMode).toBe(2);
    if (waiting) {
      connection.channel.ack(waiting);
    }
  });

  it('agotados los 5 reintentos, el mensaje va a la dead-letter', async () => {
    behavior = () => Promise.reject(new Error('base caída'));

    await connection.publish(
      EVENTS_EXCHANGE,
      CHECK_IN.routingKey,
      { messageId: 'm-5' },
      { headers: { 'x-retry-count': 5 } },
    );

    await vi.waitFor(async () =>
      expect(await messageCount(deadLetterQueue(CHECK_IN.name))).toBe(1),
    );
    expect(await messageCount(retryQueue(RETRY_STEPS[4]))).toBe(0);
  });

  it('la lista del día y sus actualizaciones llegan a la cola del Módulo 1 como mensajes persistentes', async () => {
    await connection.publish(EVENTS_EXCHANGE, DAILY_LIST_ROUTING_KEYS.LIST, {
      messageId: 'm-6',
    });
    await connection.publish(EVENTS_EXCHANGE, DAILY_LIST_ROUTING_KEYS.UPDATE, {
      messageId: 'm-7',
    });

    await vi.waitFor(async () =>
      expect(await messageCount(DAILY_LIST_QUEUE)).toBe(2),
    );
    const first = await connection.channel.get(DAILY_LIST_QUEUE, {
      noAck: true,
    });
    expect(first && first.properties.deliveryMode).toBe(2);
    expect(first && JSON.parse(first.content.toString())).toEqual({
      messageId: 'm-6',
    });
  });
});

describe('MessagingModule sin RabbitMQ', () => {
  it('arranca aunque RabbitMQ no responda, y una publicación sin confirmar falla a los 5 s', async () => {
    const startedAt = Date.now();
    // Nadie escucha en el puerto 1.
    const moduleRef = await startMessaging(
      'amqp://hospitua:hospitua@127.0.0.1:1',
    );
    try {
      expect(Date.now() - startedAt).toBeLessThan(5_000);
      const connection = moduleRef.get(AmqpConnection);
      expect(connection.connected).toBe(false);

      const publishedAt = Date.now();
      await expect(
        connection.publish(EVENTS_EXCHANGE, DAILY_LIST_ROUTING_KEYS.LIST, {
          messageId: 'm-8',
        }),
      ).rejects.toThrow('timeout');
      expect(Date.now() - publishedAt).toBeGreaterThanOrEqual(4_500);
    } finally {
      await moduleRef.close();
    }
  });
});
