import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { setupServer } from 'msw/node';
import type { App } from 'supertest/types.js';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CLOCK, type Clock } from '../../../src/application/ports/out/clock.js';
import {
  DAILY_MESSAGE_REPOSITORY,
  type DailyMessageRepository,
} from '../../../src/application/ports/out/daily-message.repository.js';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../src/application/ports/out/transaction.js';
import { configureApp } from '../../../src/configure-app.js';
import { integrationEnv, truncateAllTables } from '../support/database.js';

/**
 * T029 de `check-view-reservation`: el respaldo de la publicación. Con la aplicación completa, PostgreSQL y
 * RabbitMQ reales, un mensaje `PENDING` que no pasó por la publicación inmediata (se guarda con el
 * repositorio, sin `DailyListChangeRecorder` ni `GenerateDailyList`) lo publica `PublishPendingJob`, la
 * tarea de cada 10 s de `JobsModule`.
 */

/** El día operativo con el que arranca la aplicación. */
const TODAY = '2035-03-01';
/** El día del mensaje de la prueba: otro, para no cruzarse con la lista que se genera al arrancar. */
const MESSAGE_DAY = '2035-03-02';
const clock: Clock = {
  today: () => TODAY,
  now: () => new Date('2035-03-01T15:00:00.000Z'),
};

/** Una ejecución de la tarea cada 10 s, más el margen de la publicación. */
const BACKUP_LIMIT_MS = 15_000;

const server = setupServer();

describe('Respaldo de la publicación: la tarea de cada 10 s (T029)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;

  const statusOf = async (messageId: string): Promise<string | undefined> => {
    const [row]: { publish_status: string }[] = await dataSource.query(
      'SELECT publish_status FROM daily_list_message WHERE message_id = $1',
      [messageId],
    );
    return row?.publish_status;
  };

  beforeAll(async () => {
    // AppConfigModule lee el entorno al importarse: AppModule se importa después de asignarlo.
    Object.assign(process.env, { NODE_ENV: 'test', ...integrationEnv() });
    const { AppModule } = await import('../../../src/app.module.js');
    // La aplicación completa también llama a Channex al arrancar, y esta prueba no lo simula.
    server.listen({ onUnhandledRequest: 'bypass' });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CLOCK)
      .useValue(clock)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    dataSource = app.get(DataSource);
    await truncateAllTables(dataSource);
  });

  afterAll(async () => {
    server.close();
    await app?.close();
  });

  it(`un mensaje PENDING guardado sin la publicación inmediata queda PUBLISHED en menos de ${BACKUP_LIMIT_MS / 1000} s`, async () => {
    const messageId = randomUUID();

    await app.get<TransactionRunner>(TRANSACTION_RUNNER).run((tx) =>
      app.get<DailyMessageRepository>(DAILY_MESSAGE_REPOSITORY).insert(
        {
          messageId,
          operationalDate: MESSAGE_DAY,
          sequenceNumber: 1,
          kind: 'LIST',
          updateType: null,
          reservationId: null,
          removalReason: null,
          payload: {
            messageId,
            operationalDate: MESSAGE_DAY,
            reservations: [],
          },
        },
        tx,
      ),
    );
    const start = performance.now();

    await vi.waitFor(
      async () => {
        expect(await statusOf(messageId)).toBe('PUBLISHED');
      },
      { timeout: BACKUP_LIMIT_MS, interval: 100 },
    );

    expect(performance.now() - start).toBeLessThan(BACKUP_LIMIT_MS);
  }, 30_000);
});
