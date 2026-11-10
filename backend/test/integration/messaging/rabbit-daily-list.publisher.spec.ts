import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { Inject, Injectable, Module, type Type } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import type { GetMessage } from 'amqplib';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  inject,
  it,
  vi,
} from 'vitest';
import {
  DAILY_LIST_PUBLISHER,
  type DailyListPublisher,
} from '../../../src/application/ports/out/daily-list-publisher.js';
import { MessagingModule } from '../../../src/infrastructure/config/messaging.module.js';
import { DAILY_LIST_QUEUE } from '../../../src/infrastructure/config/rabbitmq.topology.js';
import { RabbitDailyListPublisher } from '../../../src/infrastructure/out/messaging/rabbit-daily-list.publisher.js';
import { integrationEnv } from '../support/database.js';

const LIST_ID = '0b6f8a52-1c3d-4e5f-9a7b-1c2d3e4f5a6b';
const UPDATE_ID = '7c8d9e0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f';

/** Un servicio de otro módulo, que no importa `MessagingModule`, como lo hará `PublishPendingDailyMessages`. */
@Injectable()
class NeedsPublisher {
  constructor(
    @Inject(DAILY_LIST_PUBLISHER) readonly publisher: DailyListPublisher,
  ) {}
}

@Module({ providers: [NeedsPublisher] })
class OtherModule {}

/** `MessagingModule` con la conexión a `url`, como lo arma `AppModule`, junto con los módulos `others`. */
async function startMessaging(
  url: string,
  others: Type[] = [],
): Promise<TestingModule> {
  process.env.RABBITMQ_URL = url;
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
      MessagingModule,
      ...others,
    ],
  }).compile();
  moduleRef.useLogger(false);
  return moduleRef.init();
}

/** El código HTTP de la API del panel de RabbitMQ, con las credenciales de `RABBITMQ_URL`. */
async function managementStatus(path: string): Promise<number> {
  const url = new URL(integrationEnv().RABBITMQ_URL);
  const credentials = Buffer.from(
    `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`,
  ).toString('base64');
  const response = await fetch(
    `${inject('rabbitmqManagementUrl')}/api${path}`,
    { headers: { Authorization: `Basic ${credentials}` } },
  );
  return response.status;
}

/**
 * `RabbitDailyListPublisher` contra el RabbitMQ de Testcontainers (plan de `check-view-reservation`,
 * "Publicar los mensajes"; T025): lo que llega a `m1.reservas.diarias.queue`, la cola del Módulo 1.
 */
describe('RabbitDailyListPublisher con RabbitMQ', () => {
  let moduleRef: TestingModule;
  let connection: AmqpConnection;
  let publisher: DailyListPublisher;

  /** Saca el siguiente mensaje de la cola del Módulo 1; `false` si está vacía. */
  const next = (): Promise<GetMessage | false> =>
    connection.channel.get(DAILY_LIST_QUEUE, { noAck: true });

  beforeAll(async () => {
    moduleRef = await startMessaging(integrationEnv().RABBITMQ_URL);
    connection = moduleRef.get(AmqpConnection);
    publisher = moduleRef.get(DAILY_LIST_PUBLISHER);
    // El arranque no espera a RabbitMQ (`wait: false`): la prueba vacía la cola cuando este módulo ya
    // tiene su canal y la cola ya está declarada (otra prueba pudo declararla antes). La cola se consulta
    // por el panel porque revisar por el canal una cola que no existe cierra el canal.
    await vi.waitFor(
      async () => {
        expect(() => connection.channel).not.toThrow();
        expect(await managementStatus(`/queues/%2F/${DAILY_LIST_QUEUE}`)).toBe(
          200,
        );
      },
      { timeout: 15_000, interval: 100 },
    );
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  beforeEach(async () => {
    await connection.channel.purgeQueue(DAILY_LIST_QUEUE);
  });

  it('la lista y su actualización llegan a la cola del Módulo 1 en el orden publicado, persistentes, en JSON y con su message_id', async () => {
    const list = {
      messageId: LIST_ID,
      sequenceNumber: 1,
      operationalDate: '2026-10-09',
      reservations: [],
    };
    const update = {
      messageId: UPDATE_ID,
      sequenceNumber: 2,
      operationalDate: '2026-10-09',
      updateType: 'REMOVED',
      reservationRef: 'RSV-8D02E5A4',
      removalReason: 'CANCELLED',
    };

    await publisher.publish({
      messageId: LIST_ID,
      kind: 'LIST',
      payload: list,
    });
    await publisher.publish({
      messageId: UPDATE_ID,
      kind: 'UPDATE',
      payload: update,
    });

    const first = await next();
    const second = await next();
    expect(await next()).toBe(false);
    for (const [received, routingKey, messageId, payload] of [
      [first, 'reserva.lista-del-dia', LIST_ID, list],
      [second, 'reserva.lista-del-dia.actualizacion', UPDATE_ID, update],
    ] as const) {
      if (received === false) {
        throw new Error(`No llegó el mensaje ${messageId}`);
      }
      expect(received.fields.exchange).toBe('hospitua.events');
      expect(received.fields.routingKey).toBe(routingKey);
      // deliveryMode 2: persistente.
      expect(received.properties).toMatchObject({
        deliveryMode: 2,
        contentType: 'application/json',
        messageId,
      });
      // El payload tal como está guardado, sin envoltura.
      expect(JSON.parse(received.content.toString('utf8'))).toEqual(payload);
    }
  });
});

describe('RabbitDailyListPublisher sin conexión con RabbitMQ', () => {
  let offline: TestingModule;

  beforeAll(async () => {
    // Nadie escucha en el puerto 1: la conexión nunca se establece.
    offline = await startMessaging('amqp://hospitua:hospitua@127.0.0.1:1', [
      OtherModule,
    ]);
  });

  afterAll(async () => {
    await offline?.close();
    process.env.RABBITMQ_URL = integrationEnv().RABBITMQ_URL;
  });

  // Inyectarlo no necesita la conexión: basta con que MessagingModule lo exporte.
  it('es global: otro módulo recibe el publicador sin importar MessagingModule', () => {
    expect(offline.get(NeedsPublisher).publisher).toBeInstanceOf(
      RabbitDailyListPublisher,
    );
  });

  it('la publicación falla en vez de quedarse esperando', async () => {
    const publisher = offline.get<DailyListPublisher>(DAILY_LIST_PUBLISHER);
    const startedAt = Date.now();

    // Si nunca hubo conexión, la librería no tiene canal y falla enseguida. Si la conexión se cae
    // después, el mensaje espera en memoria y falla a los 5 s sin confirmación (rabbitMqOptions).
    await expect(
      publisher.publish({
        messageId: LIST_ID,
        kind: 'LIST',
        payload: { messageId: LIST_ID },
      }),
    ).rejects.toThrow();

    expect(Date.now() - startedAt).toBeLessThan(6_000);
  });
});
