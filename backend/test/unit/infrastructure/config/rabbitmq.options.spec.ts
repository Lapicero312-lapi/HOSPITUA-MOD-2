import { MessageHandlerErrorBehavior } from '@golevelup/nestjs-rabbitmq';
import { describe, expect, it } from 'vitest';
import { rabbitMqOptions } from '../../../../src/infrastructure/config/rabbitmq.options.js';
import {
  deadLetterQueue,
  INBOUND_QUEUES,
  RETRY_STEPS,
  retryExchange,
  retryQueue,
} from '../../../../src/infrastructure/config/rabbitmq.topology.js';

const URI = 'amqp://hospitua:hospitua@localhost:5672';

describe('rabbitMqOptions', () => {
  const options = rabbitMqOptions(URI, { declareEventsExchange: true });
  /** Las declaraciones de una cola: una por cada exchange al que se une. */
  const declarations = (name: string) =>
    (options.queues ?? []).filter((q) => q.name === name);
  const queue = (name: string) => declarations(name)[0];
  const RETRY_EXCHANGES = [
    { name: 'm2.direct', type: 'direct', options: { durable: true } },
    { name: 'm2.reintento.5s', type: 'fanout', options: { durable: true } },
    { name: 'm2.reintento.15s', type: 'fanout', options: { durable: true } },
    { name: 'm2.reintento.45s', type: 'fanout', options: { durable: true } },
    { name: 'm2.reintento.2m', type: 'fanout', options: { durable: true } },
    { name: 'm2.reintento.5m', type: 'fanout', options: { durable: true } },
  ];

  it('en desarrollo y pruebas declara el exchange topic hospitua.events, el direct m2.direct y un fanout por cada espera de reintento', () => {
    expect(options.uri).toBe(URI);
    expect(options.exchanges).toEqual([
      { name: 'hospitua.events', type: 'topic', options: { durable: true } },
      ...RETRY_EXCHANGES,
    ]);
  });

  it('en producción no declara hospitua.events, que es del Módulo 1: solo comprueba que existe (T022)', () => {
    const production = rabbitMqOptions(URI, { declareEventsExchange: false });

    expect(production.exchanges).toEqual([
      {
        name: 'hospitua.events',
        type: 'topic',
        createExchangeIfNotExists: false,
      },
      ...RETRY_EXCHANGES,
    ]);
    // Lo demás no cambia: las colas siguen unidas a hospitua.events.
    expect(production.queues).toEqual(options.queues);
  });

  it('cada cola de entrada se une a su routing key en hospitua.events y a su nombre en m2.direct, y manda lo rechazado a su .dlq por m2.direct', () => {
    expect(Object.values(INBOUND_QUEUES)).toHaveLength(4);
    for (const inbound of Object.values(INBOUND_QUEUES)) {
      const options = {
        durable: true,
        deadLetterExchange: 'm2.direct',
        deadLetterRoutingKey: deadLetterQueue(inbound.name),
      };
      expect(declarations(inbound.name)).toEqual([
        {
          name: inbound.name,
          exchange: 'hospitua.events',
          routingKey: inbound.routingKey,
          options,
        },
        {
          name: inbound.name,
          exchange: 'm2.direct',
          routingKey: inbound.name,
          options,
        },
      ]);
      expect(declarations(deadLetterQueue(inbound.name))).toEqual([
        {
          name: deadLetterQueue(inbound.name),
          exchange: 'm2.direct',
          routingKey: deadLetterQueue(inbound.name),
          options: { durable: true },
        },
      ]);
    }
  });

  it('ninguna cola usa el exchange por defecto como dead-letter: en el broker del Módulo 1 no hay permiso sobre amq.default', () => {
    for (const declared of options.queues ?? []) {
      expect(declared.options?.deadLetterExchange).not.toBe('');
    }
  });

  it('las dead-letter se llaman como su cola, terminadas en .dlq', () => {
    expect(deadLetterQueue('m2.habitacion.checkin.queue')).toBe(
      'm2.habitacion.checkin.dlq',
    );
    expect(deadLetterQueue('m2.habitacion.inventario.queue')).toBe(
      'm2.habitacion.inventario.dlq',
    );
  });

  it('esperas de 5 s, 15 s, 45 s, 2 min y 5 min, que devuelven el mensaje a su cola por m2.direct', () => {
    expect(RETRY_STEPS.map((step) => step.delayMs)).toEqual([
      5_000, 15_000, 45_000, 120_000, 300_000,
    ]);
    for (const step of RETRY_STEPS) {
      expect(queue(retryQueue(step))).toEqual({
        name: retryQueue(step),
        exchange: retryExchange(step),
        routingKey: '',
        options: {
          durable: true,
          messageTtl: step.delayMs,
          deadLetterExchange: 'm2.direct',
        },
      });
    }
    expect(retryQueue(RETRY_STEPS[0])).toBe('m2.reintento.5s.queue');
  });

  it('no declara la cola del Módulo 1: es suya, con su propia dead-letter (la lista sale con mandatory)', () => {
    expect((options.queues ?? []).map(({ name }) => name)).not.toContain(
      'm1.reservas.diarias.queue',
    );
  });

  it('no espera a RabbitMQ para arrancar, un mensaje a la vez y nunca reencola sin fin', () => {
    expect(options.connectionInitOptions).toEqual({ wait: false });
    expect(options.prefetchCount).toBe(1);
    expect(options.defaultSubscribeErrorBehavior).toBe(
      MessageHandlerErrorBehavior.NACK,
    );
    expect(options.registerHandlers).toBe(false);
  });

  it('publica mensajes persistentes y da por fallida una publicación sin confirmar en 5 s', () => {
    expect(options.defaultPublishOptions).toEqual({
      persistent: true,
      timeout: 5_000,
    });
  });
});
