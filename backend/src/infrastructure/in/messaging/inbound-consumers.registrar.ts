import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { inboundQueueOptions } from '../../config/rabbitmq.options.js';
import { ConsumesQueue, type InboundConsumer } from './inbound-consumer.js';
import { retryOrDeadLetter } from './retry-or-dead-letter.js';

/**
 * Conecta cada clase marcada con `@ConsumesQueue` a su cola. No espera a que RabbitMQ responda: la
 * suscripción se completa cuando hay conexión y se rehace sola al reconectar, así que el Módulo 2
 * arranca aunque RabbitMQ no esté disponible.
 */
@Injectable()
export class InboundConsumersRegistrar implements OnApplicationBootstrap {
  private readonly logger = new Logger(InboundConsumersRegistrar.name);

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
      this.connection.managedChannel
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
    }
  }
}
