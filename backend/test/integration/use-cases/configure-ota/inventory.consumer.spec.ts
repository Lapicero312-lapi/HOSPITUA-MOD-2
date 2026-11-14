import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { DataSource, type QueryRunner } from 'typeorm';
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
  CHANNEX_SETUP_STATE,
  type ChannexSetupState,
} from '../../../../src/application/ports/out/channex-setup-state.js';
import {
  CLOCK,
  type Clock,
} from '../../../../src/application/ports/out/clock.js';
import { CHANNEX_LOCK } from '../../../../src/application/use-cases/configure-ota/channex-lock.js';
import {
  SYNC_ROOM_TYPES,
  type SyncRoomTypes,
} from '../../../../src/application/use-cases/configure-ota/ports/in/sync-room-types.port.js';
import {
  deadLetterQueue,
  EVENTS_EXCHANGE,
  INBOUND_QUEUES,
} from '../../../../src/infrastructure/config/rabbitmq.topology.js';
import { integrationEnv, truncateAllTables } from '../../support/database.js';

/**
 * T012b de `configure-ota`: el consumidor de `m2.habitacion.inventario.queue` (E2) con RabbitMQ y
 * PostgreSQL reales, como el de E1. Un aviso sincroniza los tipos de habitación con el bloqueo de las tareas
 * de Channex y deja las marcas de disponibilidad (`ari_pending_change`) y su fila en `processed_message`;
 * uno repetido no repite nada; uno inutilizable va a la dead-letter; con el bloqueo ocupado, se reintenta.
 *
 * Channex está listo (su estado se simula) y `SyncRoomTypes` se simula: lo que prueba es lo de E2, no C1.
 */

const INVENTORY = INBOUND_QUEUES.INVENTORY;
const DEAD_LETTER = deadLetterQueue(INVENTORY.name);
const TODAY = '2026-11-10';
/** Hoy más 90 días (`CHANNEX_ARI_DAYS`): el fin, excluido, de las marcas. */
const LIMIT = '2027-02-08';
const clock: Clock = {
  today: () => TODAY,
  now: () => new Date('2026-11-10T15:00:00.000Z'),
};
const channexReady = {
  isReady: () => true,
  isDisabled: () => false,
  settings: () => ({
    baseUrl: 'https://staging.channex.io',
    propertyId: '716305c4-561a-4561-a187-7f5b8aeb5920',
    syncIntervalSeconds: 30,
    ariDays: 90,
  }),
  markReady: () => {},
  disable: () => {},
} satisfies ChannexSetupState;

describe('InventoryConsumer con RabbitMQ y PostgreSQL reales (T012b de configure-ota)', () => {
  let moduleRef: TestingModule;
  let connection: AmqpConnection;
  let dataSource: DataSource;
  const sync = vi.fn<SyncRoomTypes['sync']>(() =>
    Promise.resolve({ status: 'SYNCED', created: [] }),
  );

  /** El ejemplo de E2 del plan, con un `messageId` nuevo. */
  const aNotice = (changes: Record<string, unknown> = {}) => ({
    messageId: crypto.randomUUID(),
    sequenceNumber: 4,
    action: 'UPDATED',
    roomId: '3f6c1e2a-8b4d-4c7e-9a1f-2b3c4d5e6f70',
    categoryRoom: 'SUITE',
    maxCapacity: 4,
    previousCategoryRoom: 'DOBLE',
    ...changes,
  });

  const publish = (message: unknown) =>
    connection.publish(EVENTS_EXCHANGE, INVENTORY.routingKey, message, {
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
       FROM ari_pending_change ORDER BY category_room`,
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
      .overrideProvider(CHANNEX_SETUP_STATE)
      .useValue(channexReady)
      .overrideProvider(SYNC_ROOM_TYPES)
      .useValue({ sync })
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
          (await connection.channel.checkQueue(INVENTORY.name)).consumerCount,
        ).toBe(1),
      { timeout: 15_000, interval: 100 },
    );
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  beforeEach(async () => {
    await connection.channel.purgeQueue(INVENTORY.name);
    await connection.channel.purgeQueue(DEAD_LETTER);
    await truncateAllTables(dataSource);
    sync.mockClear();
  });

  it('el ejemplo de E2 (UPDATED): sincroniza los tipos, anota los 90 días de SUITE y de DOBLE, y registra el mensaje', async () => {
    const notice = aNotice();

    await publish(notice);

    await vi.waitFor(async () => expect(await processed()).toHaveLength(1), {
      timeout: 10_000,
      interval: 100,
    });
    expect(sync).toHaveBeenCalledOnce();
    expect(await pendingChanges()).toEqual([
      { category_room: 'DOBLE', date_from: TODAY, date_to: LIMIT },
      { category_room: 'SUITE', date_from: TODAY, date_to: LIMIT },
    ]);
    expect(await processed()).toEqual([
      { message_id: notice.messageId, queue: INVENTORY.name },
    ]);
  });

  it('el mismo mensaje dos veces no vuelve a sincronizar ni repite las marcas', async () => {
    const notice = aNotice({
      action: 'ADDED',
      previousCategoryRoom: undefined,
    });

    await publish(notice);
    await vi.waitFor(async () => expect(await processed()).toHaveLength(1), {
      timeout: 10_000,
      interval: 100,
    });
    await publish(notice);
    // Una entrega más para saber que la segunda ya se atendió: la cola procesa en orden.
    await publish(aNotice({ action: 'REMOVED', categoryRoom: 'SUITE_JUNIOR' }));
    await vi.waitFor(async () => expect(await processed()).toHaveLength(2), {
      timeout: 10_000,
      interval: 100,
    });

    expect(sync).toHaveBeenCalledTimes(2);
    expect(
      (await pendingChanges()).filter(
        ({ category_room }) => category_room === 'SUITE',
      ),
    ).toEqual([{ category_room: 'SUITE', date_from: TODAY, date_to: LIMIT }]);
    expect(await messageCount(DEAD_LETTER)).toBe(0);
  });

  it('con el bloqueo de Channex ocupado no procesa nada; cuando se suelta, el reintento lo procesa', async () => {
    // Otra tarea de Channex (otra conexión, como otra instancia) tiene el bloqueo.
    const holder: QueryRunner = dataSource.createQueryRunner();
    await holder.connect();
    try {
      await holder.query('SELECT pg_advisory_lock(hashtext($1))', [
        CHANNEX_LOCK,
      ]);
      const notice = aNotice();

      await publish(notice);
      // El aviso salió de la cola hacia la espera del primer reintento (5 s), sin procesarse.
      await vi.waitFor(
        async () => expect(await messageCount(INVENTORY.name)).toBe(0),
        { timeout: 10_000, interval: 100 },
      );
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      expect(sync).not.toHaveBeenCalled();
      expect(await pendingChanges()).toEqual([]);
      expect(await processed()).toEqual([]);

      await holder.query('SELECT pg_advisory_unlock(hashtext($1))', [
        CHANNEX_LOCK,
      ]);
      await vi.waitFor(
        async () =>
          expect(await processed()).toEqual([
            { message_id: notice.messageId, queue: INVENTORY.name },
          ]),
        { timeout: 15_000, interval: 200 },
      );
      expect(sync).toHaveBeenCalledOnce();
      expect(await pendingChanges()).toHaveLength(2);
      expect(await messageCount(DEAD_LETTER)).toBe(0);
    } finally {
      await holder.query('SELECT pg_advisory_unlock_all()');
      await holder.release();
    }
  }, 30_000);

  it('con NOT_SYNCED anota las marcas y confirma el aviso igual', async () => {
    sync.mockResolvedValueOnce({
      status: 'NOT_SYNCED',
      reason: 'CHANNEX_UNAVAILABLE',
    });

    await publish(aNotice({ previousCategoryRoom: undefined }));

    await vi.waitFor(async () => expect(await processed()).toHaveLength(1), {
      timeout: 10_000,
      interval: 100,
    });
    expect(await pendingChanges()).toEqual([
      { category_room: 'SUITE', date_from: TODAY, date_to: LIMIT },
    ]);
  });

  it.each<[string, Record<string, unknown>]>([
    ['sin roomId', { roomId: undefined }],
    ['sin categoryRoom', { categoryRoom: undefined }],
    ['con una action desconocida', { action: 'MOVED' }],
  ])(
    'un aviso %s va a la dead-letter sin sincronizar, sin dejar marcas ni registrarse',
    async (_, changes) => {
      await publish(aNotice(changes));

      await vi.waitFor(
        async () => expect(await messageCount(DEAD_LETTER)).toBe(1),
        { timeout: 10_000, interval: 100 },
      );
      expect(sync).not.toHaveBeenCalled();
      expect(await pendingChanges()).toEqual([]);
      expect(await processed()).toEqual([]);
    },
  );
});
