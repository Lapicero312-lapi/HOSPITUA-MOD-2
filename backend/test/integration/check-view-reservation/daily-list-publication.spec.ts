import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { setupServer } from 'msw/node';
import type { App } from 'supertest/types.js';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CLOCK, type Clock } from '../../../src/application/ports/out/clock.js';
import {
  RESERVATION_REPOSITORY,
  type ReservationRepository,
} from '../../../src/application/ports/out/reservation.repository.js';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../src/application/ports/out/transaction.js';
import {
  DAILY_LIST_CHANGE_RECORDER,
  type DailyListChangeRecorder,
} from '../../../src/application/use-cases/check-view-reservation/ports/in/daily-list-change-recorder.port.js';
import {
  GENERATE_DAILY_LIST,
  type GenerateDailyList,
} from '../../../src/application/use-cases/check-view-reservation/ports/in/generate-daily-list.port.js';
import { configureApp } from '../../../src/configure-app.js';
import { PublishPendingJob } from '../../../src/infrastructure/in/jobs/publish-pending.job.js';
import { aDirectReservation, aDirectRoom } from '../../support/builders.js';
import { integrationEnv, truncateAllTables } from '../support/database.js';

/**
 * T029 de `check-view-reservation`: la publicación inmediata, con la aplicación completa y PostgreSQL y
 * RabbitMQ reales. La lista del día sale apenas se confirma su generación, y una actualización, apenas se
 * confirma el cambio que la origina: en menos de 5 s (NFR-005), sin esperar a la tarea de cada 10 s.
 * La tarea está apagada, para que solo pueda publicar la inmediata; el respaldo se prueba en
 * `publish-pending-job.spec.ts`.
 */

/** El día operativo de la prueba. */
const TODAY = '2034-05-01';
const clock: Clock = {
  today: () => TODAY,
  now: () => new Date('2034-05-01T15:00:00.000Z'),
};

const NFR_005_MS = 5_000;

const server = setupServer();

describe('Publicación inmediata de la lista del día (T029, NFR-004 y NFR-005)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;

  /** El estado de publicación de los mensajes del día, por secuencia. */
  const messagesOfToday = (): Promise<
    { sequence_number: number; publish_status: string }[]
  > =>
    dataSource.query(
      `SELECT sequence_number, publish_status FROM daily_list_message
       WHERE operational_date = $1 ORDER BY sequence_number`,
      [TODAY],
    );

  /** Cuánto tarda en quedar publicado el mensaje con esa secuencia, en milisegundos. */
  async function timeUntilPublished(sequence: number): Promise<number> {
    const start = performance.now();
    await vi.waitFor(
      async () => {
        const message = (await messagesOfToday()).find(
          (row) => row.sequence_number === sequence,
        );
        expect(message?.publish_status).toBe('PUBLISHED');
      },
      { timeout: NFR_005_MS * 2, interval: 50 },
    );
    return performance.now() - start;
  }

  beforeAll(async () => {
    // AppConfigModule lee el entorno al importarse: AppModule se importa después de asignarlo.
    Object.assign(process.env, { NODE_ENV: 'test', ...integrationEnv() });
    const { AppModule } = await import('../../../src/app.module.js');
    // La aplicación completa también llama a Channex al arrancar, y esta prueba no lo simula.
    server.listen({ onUnhandledRequest: 'bypass' });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CLOCK)
      .useValue(clock)
      .overrideProvider(PublishPendingJob)
      .useValue({})
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    dataSource = app.get(DataSource);
    // Al arrancar, la tarea de las 00:00 ya generó la lista de hoy (vacía): se empieza de cero.
    await truncateAllTables(dataSource);
  });

  afterAll(async () => {
    server.close();
    await app?.close();
  });

  it('la lista del día queda publicada apenas se confirma su generación', async () => {
    await app.get<ReservationRepository>(RESERVATION_REPOSITORY).insert(
      aDirectReservation({
        startDate: TODAY,
        endDate: '2034-05-03',
        rooms: [aDirectRoom({ roomNumber: '201' })],
      }),
    );

    expect(
      await app.get<GenerateDailyList>(GENERATE_DAILY_LIST).execute(TODAY),
    ).toBe(true);

    expect(await timeUntilPublished(1)).toBeLessThan(NFR_005_MS);
  });

  it('NFR-005: una actualización queda publicada en menos de 5 s desde que se confirma el cambio', async () => {
    const reservation = await app
      .get<ReservationRepository>(RESERVATION_REPOSITORY)
      .insert(
        aDirectReservation({
          startDate: TODAY,
          endDate: '2034-05-04',
          rooms: [aDirectRoom({ roomNumber: '202' })],
        }),
      );

    // Un cambio confirmado que avisa a la lista ya enviada: una reserva nueva para hoy (ADDED).
    await app
      .get<TransactionRunner>(TRANSACTION_RUNNER)
      .run((tx) =>
        app
          .get<DailyListChangeRecorder>(DAILY_LIST_CHANGE_RECORDER)
          .record(tx, null, reservation),
      );

    expect(await timeUntilPublished(2)).toBeLessThan(NFR_005_MS);
    expect(await messagesOfToday()).toEqual([
      { sequence_number: 1, publish_status: 'PUBLISHED' },
      { sequence_number: 2, publish_status: 'PUBLISHED' },
    ]);
  });

  it('si el cambio se revierte, no queda ningún mensaje que publicar', async () => {
    const reservation = await app
      .get<ReservationRepository>(RESERVATION_REPOSITORY)
      .insert(
        aDirectReservation({
          startDate: TODAY,
          endDate: '2034-05-05',
          rooms: [aDirectRoom({ roomNumber: '203' })],
        }),
      );

    await expect(
      app.get<TransactionRunner>(TRANSACTION_RUNNER).run(async (tx) => {
        await app
          .get<DailyListChangeRecorder>(DAILY_LIST_CHANGE_RECORDER)
          .record(tx, null, reservation);
        throw new Error('se revierte el cambio');
      }),
    ).rejects.toThrow('se revierte el cambio');

    expect(await messagesOfToday()).toHaveLength(2);
  });
});
