import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { Injectable } from '@nestjs/common';
import type { Channel, ConsumeMessage } from 'amqplib';
import type {
  DailyListPublisher,
  PublishableDailyMessage,
} from '../../../application/ports/out/daily-list-publisher.js';
import {
  DAILY_LIST_ROUTING_KEYS,
  EVENTS_EXCHANGE,
} from '../../config/rabbitmq.topology.js';

/**
 * RabbitMQ devolvió el mensaje porque ninguna cola lo recibe: `m1.reservas.diarias.queue` todavía no existe.
 * Cuenta como fallo de publicación (queda `PENDING` y se reintenta en orden). No lleva datos del mensaje.
 */
export class UnroutableDailyMessageError extends Error {
  constructor(routingKey: string) {
    super(
      `RabbitMQ devolvió el mensaje: ninguna cola recibe ${routingKey} (la cola del Módulo 1 aún no existe).`,
    );
  }
}

/**
 * `DailyListPublisher` con RabbitMQ (plan de `check-view-reservation`, "Publicar los mensajes"; T025):
 * - al exchange `hospitua.events`, con `reserva.lista-del-dia` para la `LIST` y
 *   `reserva.lista-del-dia.actualizacion` para un `UPDATE`;
 * - el `payload` tal como está guardado, en JSON, con `message_id` igual a su `messageId`.
 *
 * Persistente y con la espera de 5 s por la confirmación: son las opciones por defecto de la conexión
 * (`rabbitMqOptions`). La librería publica por un solo canal con confirmación; sin conexión, el mensaje
 * espera en memoria y, si no sale en esos 5 s, la promesa se rechaza. No reintenta: los reintentos son de
 * `PublishPendingDailyMessages`.
 *
 * El Módulo 2 no declara `m1.reservas.diarias.queue` (es del Módulo 1). Por eso publica con `mandatory` y
 * escucha el evento `return` del canal: RabbitMQ devuelve el mensaje que no llegó a ninguna cola antes de
 * confirmarlo, y esa publicación falla con `UnroutableDailyMessageError` (plan base, "Convenciones de colas").
 */
@Injectable()
export class RabbitDailyListPublisher implements DailyListPublisher {
  /** Los `messageId` que RabbitMQ devolvió y todavía no se informaron. */
  private readonly returned = new Set<string>();
  /** El oyente de `return` se agrega una sola vez; la librería lo repite en cada canal nuevo. */
  private listening: Promise<void> | null = null;

  constructor(private readonly connection: AmqpConnection) {}

  async publish(message: PublishableDailyMessage): Promise<void> {
    await this.listenForReturns();
    const routingKey = DAILY_LIST_ROUTING_KEYS[message.kind];
    this.returned.delete(message.messageId);
    await this.connection.publish(
      EVENTS_EXCHANGE,
      routingKey,
      message.payload,
      {
        contentType: 'application/json',
        messageId: message.messageId,
        mandatory: true,
      },
    );
    // El `return` llega antes que la confirmación: si el mensaje volvió, ya está anotado.
    if (this.returned.delete(message.messageId)) {
      throw new UnroutableDailyMessageError(routingKey);
    }
  }

  private listenForReturns(): Promise<void> {
    this.listening ??= this.connection.managedChannel
      .addSetup((channel: Channel) => {
        channel.on('return', (returned: ConsumeMessage) => {
          const messageId: unknown = returned.properties.messageId;
          if (typeof messageId === 'string') {
            this.returned.add(messageId);
          }
        });
        return Promise.resolve();
      })
      .catch((error: unknown) => {
        // Si no se pudo agregar, la próxima publicación lo intenta otra vez.
        this.listening = null;
        throw error;
      });
    return this.listening;
  }
}
