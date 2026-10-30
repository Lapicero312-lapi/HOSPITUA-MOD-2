import type { Logger } from '@nestjs/common';
import type { Channel, ConsumeMessage } from 'amqplib';
import { describe, expect, it, vi } from 'vitest';
import {
  InvalidMessageError,
  retryCount,
  retryOrDeadLetter,
} from '../../../../../src/infrastructure/in/messaging/retry-or-dead-letter.js';

const QUEUE = 'm2.habitacion.checkin.queue';

const aMessage = (headers?: Record<string, unknown>): ConsumeMessage =>
  ({
    content: Buffer.from('{"messageId":"m-1"}'),
    fields: {},
    properties: { headers, deliveryMode: 2, contentType: 'application/json' },
  }) as unknown as ConsumeMessage;

/** Un canal con confirmación de publicación; `publishError` hace fallar la confirmación. */
function fakeChannel(publishError?: Error) {
  return {
    ack: vi.fn(),
    nack: vi.fn(),
    publish: vi.fn(
      (
        _exchange: string,
        _routingKey: string,
        _content: Buffer,
        _options: unknown,
        callback: (error: Error | undefined) => void,
      ) => {
        callback(publishError);
        return true;
      },
    ),
  };
}

async function handle(
  error: unknown,
  msg = aMessage(),
  channel = fakeChannel(),
) {
  // Los espías se devuelven aparte: así las pruebas no leen métodos sueltos del logger.
  const warn = vi.fn();
  const logError = vi.fn();
  await retryOrDeadLetter(QUEUE, {
    warn,
    error: logError,
  } as unknown as Logger)(channel as unknown as Channel, msg, error);
  return { channel, warn, logError };
}

describe('retryOrDeadLetter', () => {
  it('un payload que no es JSON va a la dead-letter sin reintentos', async () => {
    const msg = aMessage();
    const { channel } = await handle(new SyntaxError('Unexpected token'), msg);

    expect(channel.nack).toHaveBeenCalledWith(msg, false, false);
    expect(channel.publish).not.toHaveBeenCalled();
    expect(channel.ack).not.toHaveBeenCalled();
  });

  it('un mensaje inválido para el consumidor va a la dead-letter sin reintentos', async () => {
    const msg = aMessage();
    const { channel } = await handle(
      new InvalidMessageError('Falta reservationRef'),
      msg,
    );

    expect(channel.nack).toHaveBeenCalledWith(msg, false, false);
    expect(channel.publish).not.toHaveBeenCalled();
  });

  it('un fallo temporal aparta el mensaje 5 s con x-retry-count 1 y lo confirma en su cola', async () => {
    const msg = aMessage();
    const { channel } = await handle(new Error('base caída'), msg);

    expect(channel.publish).toHaveBeenCalledWith(
      'm2.reintento.5s',
      QUEUE,
      msg.content,
      {
        deliveryMode: 2,
        contentType: 'application/json',
        headers: { 'x-retry-count': 1 },
      },
      expect.any(Function),
    );
    expect(channel.ack).toHaveBeenCalledWith(msg);
    expect(channel.nack).not.toHaveBeenCalled();
  });

  it('cada reintento espera más que el anterior y conserva las demás cabeceras', async () => {
    const waits = [];
    for (let attempt = 0; attempt < 5; attempt++) {
      const { channel } = await handle(
        new Error('base caída'),
        aMessage({ 'x-retry-count': attempt, origen: 'm1' }),
      );
      const [exchange, , , options] = channel.publish.mock.calls[0];
      expect(options).toMatchObject({
        headers: { 'x-retry-count': attempt + 1, origen: 'm1' },
      });
      waits.push(exchange);
    }

    expect(waits).toEqual([
      'm2.reintento.5s',
      'm2.reintento.15s',
      'm2.reintento.45s',
      'm2.reintento.2m',
      'm2.reintento.5m',
    ]);
  });

  it('agotados los 5 reintentos, va a la dead-letter y lo registra como error', async () => {
    const msg = aMessage({ 'x-retry-count': 5 });
    const { channel, logError } = await handle(new Error('base caída'), msg);

    expect(channel.nack).toHaveBeenCalledWith(msg, false, false);
    expect(channel.publish).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledWith(
      `Mensaje de ${QUEUE} sin procesar después de 5 reintentos: va a la dead-letter`,
    );
  });

  it('si RabbitMQ no confirma el apartado, el mensaje vuelve a su cola sin perderse', async () => {
    const msg = aMessage();
    const { channel } = await handle(
      new Error('base caída'),
      msg,
      fakeChannel(new Error('canal cerrado')),
    );

    expect(channel.nack).toHaveBeenCalledWith(msg, false, true);
    expect(channel.ack).not.toHaveBeenCalled();
  });

  it('los logs no llevan el contenido del mensaje ni el detalle del error', async () => {
    const { warn } = await handle(new Error('Ana Pérez, pasaporte X123'));

    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain('Ana Pérez');
    expect(logged).not.toContain('m-1');
  });
});

describe('retryCount', () => {
  it('sin cabecera, o con un valor que no es un entero positivo, cuenta 0', () => {
    expect(retryCount(aMessage())).toBe(0);
    expect(retryCount(aMessage({ 'x-retry-count': '3' }))).toBe(0);
    expect(retryCount(aMessage({ 'x-retry-count': -1 }))).toBe(0);
    expect(retryCount(aMessage({ 'x-retry-count': 1.5 }))).toBe(0);
  });

  it('lee la cantidad de reintentos de x-retry-count', () => {
    expect(retryCount(aMessage({ 'x-retry-count': 2 }))).toBe(2);
  });
});
