import type { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { Logger } from '@nestjs/common';
import type { DiscoveryService } from '@nestjs/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { inboundQueueOptions } from '../../../../../src/infrastructure/config/rabbitmq.options.js';
import {
  InboundConsumersRegistrar,
  SUBSCRIPTION_SHUTDOWN_WAIT_MS,
} from '../../../../../src/infrastructure/in/messaging/inbound-consumers.registrar.js';

const CHECK_IN_QUEUE = 'm2.habitacion.checkin.queue';

/** Una promesa que la prueba resuelve o rechaza cuando quiere. */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * El registrador con un consumidor de la cola de Check-In (o ninguno), una conexión que conecta cuando la
 * prueba resuelve `connected`, y una suscripción que termina cuando la prueba resuelve `subscribed`.
 */
function registrarWith({ consumers = 1 } = {}) {
  const connected = deferred();
  const subscribed = deferred<{ consumerTag: string }>();
  const handle = vi.fn(() => Promise.resolve());
  const discovery = {
    getProviders: vi.fn(() =>
      Array.from({ length: consumers }, () => ({
        name: 'CheckInConsumer',
        instance: { handle },
      })),
    ),
    getMetadataByDecorator: vi.fn(() => CHECK_IN_QUEUE),
  } as unknown as DiscoveryService;
  const createSubscriber = vi.fn(() => subscribed.promise);
  const connection = {
    managedChannel: { waitForConnect: () => connected.promise },
    createSubscriber,
  } as unknown as AmqpConnection;
  const registrar = new InboundConsumersRegistrar(discovery, connection);
  return { registrar, connected, subscribed, createSubscriber, handle };
}

/** Si la promesa ya terminó, sin esperarla. */
async function isSettled(promise: Promise<unknown>): Promise<boolean> {
  let settled = false;
  void promise.then(
    () => (settled = true),
    () => (settled = true),
  );
  // Deja correr las promesas ya resueltas.
  await new Promise((resolve) => setImmediate(resolve));
  return settled;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('InboundConsumersRegistrar', () => {
  it('suscribe cada consumidor a su cola cuando hay conexión, con su dead-letter y sus reintentos', async () => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const { registrar, connected, subscribed, createSubscriber, handle } =
      registrarWith();

    registrar.onApplicationBootstrap();
    expect(createSubscriber).not.toHaveBeenCalled();
    connected.resolve();
    subscribed.resolve({ consumerTag: 'tag' });
    await registrar.beforeApplicationShutdown();

    expect(createSubscriber).toHaveBeenCalledExactlyOnceWith(
      expect.any(Function),
      {
        queue: CHECK_IN_QUEUE,
        queueOptions: inboundQueueOptions(CHECK_IN_QUEUE),
        errorHandler: expect.any(Function) as unknown,
      },
      'CheckInConsumer',
    );
    // El manejador pasa cada mensaje al consumidor.
    const [onMessage] = createSubscriber.mock.calls[0] as unknown as [
      (message: unknown) => Promise<void>,
    ];
    await onMessage({ messageId: 'm1' });
    expect(handle).toHaveBeenCalledWith({ messageId: 'm1' });
  });

  it('el apagado espera a que termine la suscripción en curso, para no cerrar la conexión a mitad', async () => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const { registrar, connected, subscribed } = registrarWith();
    registrar.onApplicationBootstrap();
    connected.resolve();

    const shutdown = registrar.beforeApplicationShutdown();

    expect(await isSettled(shutdown)).toBe(false);
    subscribed.resolve({ consumerTag: 'tag' });
    await expect(shutdown).resolves.toBeUndefined();
  });

  it('sin RabbitMQ, el apagado no espera más que el tope', async () => {
    vi.useFakeTimers();
    const { registrar } = registrarWith();
    registrar.onApplicationBootstrap();

    const shutdown = registrar.beforeApplicationShutdown();

    await vi.advanceTimersByTimeAsync(SUBSCRIPTION_SHUTDOWN_WAIT_MS - 1);
    expect(await isSettledWithFakeTimers(shutdown)).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(shutdown).resolves.toBeUndefined();
  });

  it('una suscripción que falla queda en el log y no traba ni rompe el apagado', async () => {
    const error = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const { registrar, connected, subscribed } = registrarWith();
    registrar.onApplicationBootstrap();
    connected.resolve();
    subscribed.reject(new Error('Channel ended, no reply will be forthcoming'));

    await expect(
      registrar.beforeApplicationShutdown(),
    ).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(
      `No se pudo consumir ${CHECK_IN_QUEUE}`,
      expect.stringContaining('Channel ended'),
    );
  });

  it('sin consumidores, el apagado no espera nada', async () => {
    vi.useFakeTimers();
    const { registrar } = registrarWith({ consumers: 0 });
    registrar.onApplicationBootstrap();

    await expect(
      registrar.beforeApplicationShutdown(),
    ).resolves.toBeUndefined();
  });

  it('el tope es de 5 s: con RabbitMQ las suscripciones terminan en milisegundos', () => {
    expect(SUBSCRIPTION_SHUTDOWN_WAIT_MS).toBe(5_000);
  });
});

/** Como `isSettled`, con los relojes simulados: deja correr las promesas sin avanzar el tiempo. */
async function isSettledWithFakeTimers(
  promise: Promise<unknown>,
): Promise<boolean> {
  let settled = false;
  void promise.then(
    () => (settled = true),
    () => (settled = true),
  );
  await vi.advanceTimersByTimeAsync(0);
  return settled;
}
