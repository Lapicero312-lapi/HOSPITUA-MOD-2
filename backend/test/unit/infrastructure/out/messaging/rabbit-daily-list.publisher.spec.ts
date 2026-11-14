import type { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { describe, expect, it, vi } from 'vitest';
import { RabbitDailyListPublisher } from '../../../../../src/infrastructure/out/messaging/rabbit-daily-list.publisher.js';

const MESSAGE_ID = '6f1d2c3b-4a5e-4f60-8a71-92b3c4d5e6f7';

/** El publicador con `AmqpConnection.publish` simulado. */
function aPublisher(publish = vi.fn().mockResolvedValue(true)) {
  const connection = { publish } as unknown as AmqpConnection;
  return { publisher: new RabbitDailyListPublisher(connection), publish };
}

describe('RabbitDailyListPublisher (plan de check-view-reservation, "Publicar los mensajes"; T025)', () => {
  it('publica la lista del día a hospitua.events con reserva.lista-del-dia, en JSON y con su message_id', async () => {
    const { publisher, publish } = aPublisher();
    const payload = { messageId: MESSAGE_ID, sequenceNumber: 1 };

    await publisher.publish({ messageId: MESSAGE_ID, kind: 'LIST', payload });

    expect(publish).toHaveBeenCalledExactlyOnceWith(
      'hospitua.events',
      'reserva.lista-del-dia',
      payload,
      { contentType: 'application/json', messageId: MESSAGE_ID },
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
      { contentType: 'application/json', messageId: MESSAGE_ID },
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
    const { publisher } = aPublisher(
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
    await Promise.resolve();
    expect(done).toBe(false);

    confirm(true);
    await publishing;
    expect(done).toBe(true);
  });
});
