import { EventEmitter } from 'node:events';
import type { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { describe, expect, it, vi } from 'vitest';
import {
  RabbitDailyListPublisher,
  UnroutableDailyMessageError,
} from '../../../../../src/infrastructure/out/messaging/rabbit-daily-list.publisher.js';

const MESSAGE_ID = '6f1d2c3b-4a5e-4f60-8a71-92b3c4d5e6f7';
const OTHER_ID = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

const PUBLISH_OPTIONS = {
  contentType: 'application/json',
  messageId: MESSAGE_ID,
  mandatory: true,
};

/**
 * El publicador con `AmqpConnection` simulado: `publish` y un canal (`EventEmitter`) que recibe el oyente de
 * `return` por `managedChannel.addSetup`, como hace `amqp-connection-manager` con cada canal nuevo.
 */
function aPublisher(publish = vi.fn().mockResolvedValue(true)) {
  const channel = new EventEmitter();
  const addSetup = vi.fn(async (setup: (channel: EventEmitter) => unknown) => {
    await setup(channel);
  });
  const connection = {
    publish,
    managedChannel: { addSetup },
  } as unknown as AmqpConnection;
  return {
    publisher: new RabbitDailyListPublisher(connection),
    publish,
    channel,
    addSetup,
  };
}

/** Lo que emite amqplib cuando RabbitMQ devuelve un mensaje `mandatory` que no llegó a ninguna cola. */
const returnOf = (messageId: string) => ({
  fields: { replyCode: 312, replyText: 'NO_ROUTE' },
  properties: { messageId },
  content: Buffer.from('{}'),
});

describe('RabbitDailyListPublisher (plan de check-view-reservation, "Publicar los mensajes"; T025)', () => {
  it('publica la lista del día a hospitua.events con reserva.lista-del-dia, en JSON, con su message_id y mandatory', async () => {
    const { publisher, publish } = aPublisher();
    const payload = { messageId: MESSAGE_ID, sequenceNumber: 1 };

    await publisher.publish({ messageId: MESSAGE_ID, kind: 'LIST', payload });

    expect(publish).toHaveBeenCalledExactlyOnceWith(
      'hospitua.events',
      'reserva.lista-del-dia',
      payload,
      PUBLISH_OPTIONS,
    );
  });

  it('publica una actualización con reserva.lista-del-dia.actualizacion', async () => {
    const { publisher, publish } = aPublisher();
    const payload = { messageId: MESSAGE_ID, sequenceNumber: 2 };

    await publisher.publish({ messageId: MESSAGE_ID, kind: 'UPDATE', payload });

    expect(publish).toHaveBeenCalledExactlyOnceWith(
      'hospitua.events',
      'reserva.lista-del-dia.actualizacion',
      payload,
      PUBLISH_OPTIONS,
    );
  });

  it('si RabbitMQ no confirma, la publicación falla con ese error', async () => {
    const error = new Error('timeout');
    const { publisher } = aPublisher(vi.fn().mockRejectedValue(error));

    await expect(
      publisher.publish({ messageId: MESSAGE_ID, kind: 'LIST', payload: {} }),
    ).rejects.toBe(error);
  });

  it('no termina antes de que RabbitMQ confirme', async () => {
    let confirm!: (value: boolean) => void;
    const { publisher, publish } = aPublisher(
      vi.fn(
        () =>
          new Promise<boolean>((resolve) => {
            confirm = resolve;
          }),
      ),
    );

    let done = false;
    const publishing = publisher
      .publish({ messageId: MESSAGE_ID, kind: 'LIST', payload: {} })
      .then(() => {
        done = true;
      });
    // Primero agrega el oyente de `return`; después publica y espera la confirmación.
    await vi.waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
    expect(done).toBe(false);

    confirm(true);
    await publishing;
    expect(done).toBe(true);
  });

  describe('sin la cola del Módulo 1 (mandatory)', () => {
    it('si RabbitMQ devuelve el mensaje antes de confirmarlo, la publicación falla y no lleva el contenido', async () => {
      const publish = vi.fn();
      const { publisher, channel } = aPublisher(publish);
      // Como RabbitMQ: primero el `return` y después la confirmación.
      publish.mockImplementation(() => {
        channel.emit('return', returnOf(MESSAGE_ID));
        return Promise.resolve(true);
      });

      const error: unknown = await publisher
        .publish({
          messageId: MESSAGE_ID,
          kind: 'LIST',
          payload: { reservations: ['dato del huésped'] },
        })
        .then(
          () => null,
          (caught: unknown) => caught,
        );

      expect(error).toBeInstanceOf(UnroutableDailyMessageError);
      expect((error as Error).message).toContain('reserva.lista-del-dia');
      expect((error as Error).message).not.toContain('dato del huésped');
    });

    it('el mensaje devuelto de otra publicación no hace fallar esta', async () => {
      const publish = vi.fn();
      const { publisher, channel } = aPublisher(publish);
      publish.mockImplementation(() => {
        channel.emit('return', returnOf(OTHER_ID));
        return Promise.resolve(true);
      });

      await expect(
        publisher.publish({ messageId: MESSAGE_ID, kind: 'LIST', payload: {} }),
      ).resolves.toBeUndefined();
    });

    it('al reintentar, si la cola ya existe, la misma publicación sale bien', async () => {
      const publish = vi.fn();
      const { publisher, channel } = aPublisher(publish);
      publish.mockImplementationOnce(() => {
        channel.emit('return', returnOf(MESSAGE_ID));
        return Promise.resolve(true);
      });
      publish.mockResolvedValueOnce(true);
      const message = {
        messageId: MESSAGE_ID,
        kind: 'LIST' as const,
        payload: {},
      };

      await expect(publisher.publish(message)).rejects.toBeInstanceOf(
        UnroutableDailyMessageError,
      );
      await expect(publisher.publish(message)).resolves.toBeUndefined();
    });

    it('agrega el oyente de return una sola vez, aunque publique muchas veces', async () => {
      const { publisher, addSetup } = aPublisher();

      for (const kind of ['LIST', 'UPDATE', 'UPDATE'] as const) {
        await publisher.publish({ messageId: MESSAGE_ID, kind, payload: {} });
      }

      expect(addSetup).toHaveBeenCalledTimes(1);
    });
  });
});
