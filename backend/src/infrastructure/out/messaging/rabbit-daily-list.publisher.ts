import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { Injectable } from '@nestjs/common';
import type {
  DailyListPublisher,
  PublishableDailyMessage,
} from '../../../application/ports/out/daily-list-publisher.js';
import {
  DAILY_LIST_ROUTING_KEYS,
  EVENTS_EXCHANGE,
} from '../../config/rabbitmq.topology.js';

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
 */
@Injectable()
export class RabbitDailyListPublisher implements DailyListPublisher {
  constructor(private readonly connection: AmqpConnection) {}

  async publish(message: PublishableDailyMessage): Promise<void> {
    await this.connection.publish(
      EVENTS_EXCHANGE,
      DAILY_LIST_ROUTING_KEYS[message.kind],
      message.payload,
      { contentType: 'application/json', messageId: message.messageId },
    );
  }
}
