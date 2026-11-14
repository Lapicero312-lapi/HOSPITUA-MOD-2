import type { MessageErrorHandler } from '@golevelup/nestjs-rabbitmq';
import { Logger } from '@nestjs/common';
import type { ConfirmChannel, ConsumeMessage, Options } from 'amqplib';
import {
  type InboundQueueName,
  RETRY_COUNT_HEADER,
  RETRY_STEPS,
  retryExchange,
} from '../../config/rabbitmq.topology.js';

/**
 * Un mensaje que el consumidor rechaza por inválido (sin `reservationRef` o `roomId`, con caracteres
 * maliciosos, ...): va directo a la dead-letter, sin reintentos (plan base, "Traducción de respuestas
 * HTTP a cola").
 */
export class InvalidMessageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidMessageError';
  }
}

/** Reintentos que ya tuvo el mensaje, según su cabecera `x-retry-count`. */
export function retryCount(msg: ConsumeMessage): number {
  const value: unknown = msg.properties.headers?.[RETRY_COUNT_HEADER];
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : 0;
}

/**
 * Lo que hace un consumidor de `queue` cuando su manejador falla (plan base, "Convenciones de colas"):
 * - un payload que no es JSON (`SyntaxError`) o inválido (`InvalidMessageError`) va a la dead-letter;
 * - cualquier otro error es un fallo temporal: el mensaje espera en la cola del siguiente reintento y
 *   vuelve a `queue`; agotados los 5 reintentos, va a la dead-letter.
 *
 * Los logs no llevan el contenido del mensaje (puede tener datos personales).
 */
export function retryOrDeadLetter(
  queue: InboundQueueName,
  logger = new Logger('Messaging'),
): MessageErrorHandler {
  return async (channel, msg, error: unknown) => {
    if (error instanceof SyntaxError || error instanceof InvalidMessageError) {
      logger.warn(
        `Mensaje inválido en ${queue}: va a la dead-letter sin reintentos`,
      );
      channel.nack(msg, false, false);
      return;
    }

    const attempt = retryCount(msg);
    const step = RETRY_STEPS[attempt];
    if (step === undefined) {
      logger.error(
        `Mensaje de ${queue} sin procesar después de ${RETRY_STEPS.length} reintentos: va a la dead-letter`,
      );
      channel.nack(msg, false, false);
      return;
    }

    try {
      // La librería entrega canales con confirmación de publicación.
      await publishConfirmed(
        channel as ConfirmChannel,
        retryExchange(step),
        queue,
        msg,
        {
          ...msg.properties,
          headers: {
            ...msg.properties.headers,
            [RETRY_COUNT_HEADER]: attempt + 1,
          },
        },
      );
      channel.ack(msg);
      logger.warn(
        `Fallo temporal en ${queue}: reintento ${attempt + 1} de ${RETRY_STEPS.length} en ${step.label}`,
      );
    } catch {
      // Si no se pudo apartar para el reintento, el mensaje vuelve a su cola sin perderse.
      logger.error(
        `No se pudo programar el reintento de un mensaje de ${queue}: vuelve a la cola`,
      );
      channel.nack(msg, false, true);
    }
  };
}

function publishConfirmed(
  channel: ConfirmChannel,
  exchange: string,
  routingKey: string,
  msg: ConsumeMessage,
  options: Options.Publish,
): Promise<void> {
  return new Promise((resolve, reject) => {
    channel.publish(exchange, routingKey, msg.content, options, (error) =>
      error ? reject(error) : resolve(),
    );
  });
}
