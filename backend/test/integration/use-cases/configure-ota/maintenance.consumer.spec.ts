import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  CLOCK,
  type Clock,
} from '../../../../src/application/ports/out/clock.js';
import {
  deadLetterQueue,
  EVENTS_EXCHANGE,
  INBOUND_QUEUES,
} from '../../../../src/infrastructure/config/rabbitmq.topology.js';
import { integrationEnv, truncateAllTables } from '../../support/database.js';

/**
 * T012b de `configure-ota`: el consumidor de `m2.habitacion.mantenimiento.queue` (E1) con RabbitMQ y
 * PostgreSQL reales, como el de Check-In. Un aviso deja las marcas de disponibilidad (`ari_pending_change`)
 * y su fila en `processed_message`; uno repetido no repite nada; uno inutilizable va a la dead-letter.
 */

const MAINTENANCE = INBOUND_QUEUES.MAINTENANCE;
const DEAD_LETTER = deadLetterQueue(MAINTENANCE.name);
const TODAY = '2026-11-10';
const clock: Clock = {
  today: () => TODAY,
  now: () => new Date('2026-11-10T15:00:00.000Z'),
};

describe('MaintenanceConsumer con RabbitMQ y PostgreSQL reales (T012b de configure-ota)', () => {
  let moduleRef: TestingModule;
  let connection: AmqpConnection;
  let dataSource: DataSource;

  /** El ejemplo de E1 del plan, con un `messageId` nuevo. */
  const aNotice = (changes: Record<string, unknown> = {}) => ({
    messageId: crypto.randomUUID(),
    sequenceNumber: 12,
    maintenanceId: crypto.randomUUID(),
    action: 'UPDATED',
    roomId: '3f6c1e2a-8b4d-4c7e-9a1f-2b3c4d5e6f70',
    categoryRoom: 'DOBLE',
    startDate: '2026-11-14',
    endDate: '2026-11-15',
    previousStartDate: '2026-11-12',
    previousEndDate: '2026-11-13',
    ...changes,
  });

  const publish = (message: unknown) =>
    connection.publish(EVENTS_EXCHANGE, MAINTENANCE.routingKey, message, {
      persistent: true,
    });

  const messageCount = async (queue: string) =>
    (await connection.channel.checkQueue(queue)).messageCount;

  const pendingChanges = (): Promise<
    { category_room: string; date_from: string; date_to: string }[]
  > =>
    dataSource.query(
      `SELECT category_room, to_char(date_from, 'YYYY-MM-DD') AS date_from,
              to_char(date_to, 'YYYY-MM-DD') AS date_to
       FROM ari_pending_change ORDER BY date_from`,
    );

  const processed = (): Promise<{ message_id: string; queue: string }[]> =>
    dataSource.query('SELECT message_id, queue FROM processed_message');

  beforeAll(async () => {
    // AppConfigModule lee el entorno al importarse: los módulos se importan después de asignarlo.
    Object.assign(process.env, { NODE_ENV: 'test', ...integrationEnv() });
    const { AppConfigModule } =
      await import('../../../../src/infrastructure/config/app-config.module.js');
    const { PersistenceModule } =
      await import('../../../../src/infrastructure/out/persistence/persistence.module.js');
    const { ClockModule } =
      await import('../../../../src/infrastructure/out/clock/clock.module.js');
    const { MessagingModule } =
      await import('../../../../src/infrastructure/config/messaging.module.js');
    const { ConsumersModule } =
      await import('../../../../src/infrastructure/in/messaging/consumers.module.js');
    // Los consumidores llegan a update-reservation y a configure-ota, que piden lo que la aplicación
    // entrega como global: Channex, el cierre del día, los Módulos 1 y 3 y la tarifa de referencia.
    const { ChannexClientModule } =
      await import('../../../../src/infrastructure/out/channex/channex-client.module.js');
    const { CloseDayConfigModule } =
      await import('../../../../src/infrastructure/config/close-day.config.js');
    const { Module1ClientModule } =
      await import('../../../../src/infrastructure/out/module1/module1-client.module.js');
    const { Module3ClientModule } =
      await import('../../../../src/infrastructure/out/module3/module3-client.module.js');
    const { RateReferenceConfigModule } =
      await import('../../../../src/infrastructure/config/rate-reference.config.js');
    moduleRef = await Test.createTestingModule({
      imports: [
        AppConfigModule,
        PersistenceModule,
        ClockModule,
        MessagingModule,
        ChannexClientModule,
        CloseDayConfigModule,
        Module1ClientModule,
        Module3ClientModule,
        RateReferenceConfigModule,
        ConsumersModule,
      ],
    })
      .overrideProvider(CLOCK)
      .useValue(clock)
      .compile();
    // Los rechazos esperados no ensucian la salida de las pruebas.
    moduleRef.useLogger(false);
    await moduleRef.init();
    connection = moduleRef.get(AmqpConnection);
    dataSource = moduleRef.get(DataSource);
    // El consumidor se suscribe cuando hay conexión, sin que el arranque lo espere.
    await vi.waitFor(
      async () =>
        expect(
          (await connection.channel.checkQueue(MAINTENANCE.name)).consumerCount,
        ).toBe(1),
      { timeout: 15_000, interval: 100 },
    );
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  beforeEach(async () => {
    await connection.channel.purgeQueue(MAINTENANCE.name);
    await connection.channel.purgeQueue(DEAD_LETTER);
    await truncateAllTables(dataSource);
  });

  it('el ejemplo de E1 (UPDATED): anota DOBLE en las fechas nuevas y en las anteriores, y registra el mensaje', async () => {
    const notice = aNotice();

    await publish(notice);

    await vi.waitFor(async () => expect(await processed()).toHaveLength(1), {
      timeout: 10_000,
      interval: 100,
    });
    expect(await pendingChanges()).toEqual([
      {
        category_room: 'DOBLE',
        date_from: '2026-11-12',
        date_to: '2026-11-14',
      },
      {
        category_room: 'DOBLE',
        date_from: '2026-11-14',
        date_to: '2026-11-16',
      },
    ]);
    expect(await processed()).toEqual([
      { message_id: notice.messageId, queue: MAINTENANCE.name },
    ]);
  });

  it('el mismo mensaje dos veces no repite las marcas', async () => {
    const notice = aNotice({ action: 'SCHEDULED' });

    await publish(notice);
    await vi.waitFor(async () => expect(await processed()).toHaveLength(1), {
      timeout: 10_000,
      interval: 100,
    });
    await publish(notice);
    await vi.waitFor(
      async () => expect(await messageCount(MAINTENANCE.name)).toBe(0),
      { timeout: 10_000, interval: 100 },
    );
    // Una entrega más para saber que la segunda ya se atendió: la cola procesa en orden.
    await publish(
      aNotice({ action: 'CANCELLED', categoryRoom: 'SUITE_JUNIOR' }),
    );
    await vi.waitFor(async () => expect(await processed()).toHaveLength(2), {
      timeout: 10_000,
      interval: 100,
    });

    expect(
      (await pendingChanges()).filter(
        ({ category_room }) => category_room === 'DOBLE',
      ),
    ).toEqual([
      {
        category_room: 'DOBLE',
        date_from: '2026-11-14',
        date_to: '2026-11-16',
      },
    ]);
    expect(await messageCount(DEAD_LETTER)).toBe(0);
  });

  it.each<[string, Record<string, unknown>]>([
    ['sin roomId', { roomId: undefined }],
    ['con una action desconocida', { action: 'DELETED' }],
    ['con fechas inválidas', { startDate: '2026-02-30' }],
  ])(
    'un aviso %s va a la dead-letter sin dejar marcas ni registrarse',
    async (_, changes) => {
      await publish(aNotice(changes));

      await vi.waitFor(
        async () => expect(await messageCount(DEAD_LETTER)).toBe(1),
        { timeout: 10_000, interval: 100 },
      );
      expect(await pendingChanges()).toEqual([]);
      expect(await processed()).toEqual([]);
    },
  );
});
