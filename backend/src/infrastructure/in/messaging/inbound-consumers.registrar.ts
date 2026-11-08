import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import {
  type BeforeApplicationShutdown,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { inboundQueueOptions } from '../../config/rabbitmq.options.js';
import { ConsumesQueue, type InboundConsumer } from './inbound-consumer.js';
import { retryOrDeadLetter } from './retry-or-dead-letter.js';

/**
 * Lo más que el apagado espera a que terminen las suscripciones en curso. Con RabbitMQ disponible
 * terminan en milisegundos; sin él, nunca empiezan, y el apagado sigue cuando se cumple este tiempo.
 */
export const SUBSCRIPTION_SHUTDOWN_WAIT_MS = 5_000;

/**
 * Conecta cada clase marcada con `@ConsumesQueue` a su cola. No espera a que RabbitMQ responda: la
 * suscripción se completa cuando hay conexión y se rehace sola al reconectar, así que el Módulo 2
 * arranca aunque RabbitMQ no esté disponible.
 *
 * Al apagarse, espera a que terminen las suscripciones que estén en curso (con un tope). Si la conexión se
 * cerrara a mitad de una, la librería dejaría su operación rechazada sin que nadie la atienda: golevelup no
 * atiende la promesa de `addSetup` con la que declara la cola y empieza a consumir.
 */
@Injectable()
export class InboundConsumersRegistrar
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private readonly logger = new Logger(InboundConsumersRegistrar.name);

  /** Una por consumidor: termina cuando quedó suscrito o falló (nunca se rechaza). */
  private readonly subscriptions: Promise<void>[] = [];

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly connection: AmqpConnection,
  ) {}

  onApplicationBootstrap(): void {
    for (const wrapper of this.discovery.getProviders({
      metadataKey: ConsumesQueue.KEY,
    })) {
      const queue = this.discovery.getMetadataByDecorator(
        ConsumesQueue,
        wrapper,
      );
      const consumer = wrapper.instance as InboundConsumer | undefined;
      if (queue === undefined || consumer === undefined) {
        continue;
      }
      // Espera a que la conexión declare todo (las dead-letter incluidas) antes de recibir mensajes.
      const subscription = this.connection.managedChannel
        .waitForConnect()
        .then(() =>
          this.connection.createSubscriber(
            (message: unknown) => consumer.handle(message),
            {
              queue,
              // Al reconectar se prepara a la vez que la declaración: la declara con los mismos argumentos.
              queueOptions: inboundQueueOptions(queue),
              errorHandler: retryOrDeadLetter(queue),
            },
            wrapper.name,
          ),
        )
        .then(() => this.logger.log(`Consumiendo ${queue}`))
        .catch((error: unknown) =>
          this.logger.error(
            `No se pudo consumir ${queue}`,
            error instanceof Error ? error.stack : String(error),
          ),
        );
      this.subscriptions.push(subscription);
    }
  }

  /**
   * Antes de que golevelup cierre la conexión (en su `onApplicationShutdown`), espera a que terminen las
   * suscripciones en curso, como mucho `SUBSCRIPTION_SHUTDOWN_WAIT_MS`.
   */
  async beforeApplicationShutdown(): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const limit = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, SUBSCRIPTION_SHUTDOWN_WAIT_MS);
    });
    try {
      await Promise.race([Promise.all(this.subscriptions), limit]);
    } finally {
      clearTimeout(timer);
    }
  }
}
