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
  const options = rabbitMqOptions(URI);
  const queue = (name: string) => options.queues?.find((q) => q.name === name);

  it('declara el exchange topic hospitua.events y un fanout por cada espera de reintento', () => {
    expect(options.uri).toBe(URI);
    expect(options.exchanges).toEqual([
      { name: 'hospitua.events', type: 'topic', options: { durable: true } },
      { name: 'm2.reintento.5s', type: 'fanout', options: { durable: true } },
      { name: 'm2.reintento.15s', type: 'fanout', options: { durable: true } },
      { name: 'm2.reintento.45s', type: 'fanout', options: { durable: true } },
      { name: 'm2.reintento.2m', type: 'fanout', options: { durable: true } },
      { name: 'm2.reintento.5m', type: 'fanout', options: { durable: true } },
    ]);
  });

  it('cada cola de entrada se une a su routing key y manda lo rechazado a su .dlq', () => {
    expect(Object.values(INBOUND_QUEUES)).toHaveLength(4);
    for (const inbound of Object.values(INBOUND_QUEUES)) {
      expect(queue(inbound.name)).toEqual({
        name: inbound.name,
        exchange: 'hospitua.events',
        routingKey: inbound.routingKey,
        options: {
          durable: true,
          deadLetterExchange: '',
          deadLetterRoutingKey: deadLetterQueue(inbound.name),
        },
      });
      expect(queue(deadLetterQueue(inbound.name))?.options).toEqual({
        durable: true,
      });
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

  it('esperas de 5 s, 15 s, 45 s, 2 min y 5 min, que devuelven el mensaje por el exchange por defecto', () => {
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
          deadLetterExchange: '',
        },
      });
    }
    expect(retryQueue(RETRY_STEPS[0])).toBe('m2.reintento.5s.queue');
  });

  it('declara la cola del Módulo 1 con las dos routing keys de la lista del día y sin argumentos extra', () => {
    expect(queue('m1.reservas.diarias.queue')).toEqual({
      name: 'm1.reservas.diarias.queue',
      exchange: 'hospitua.events',
      routingKey: [
        'reserva.lista-del-dia',
        'reserva.lista-del-dia.actualizacion',
      ],
      options: { durable: true },
    });
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
