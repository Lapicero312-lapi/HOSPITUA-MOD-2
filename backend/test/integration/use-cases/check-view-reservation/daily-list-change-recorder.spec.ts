import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Clock } from '../../../../src/application/ports/out/clock.js';
import { DailyListChangeRecorderService } from '../../../../src/application/use-cases/check-view-reservation/daily-list-change-recorder.service.js';
import { DAILY_LIST_CHANGE_RECORDER } from '../../../../src/application/use-cases/check-view-reservation/ports/in/daily-list-change-recorder.port.js';
import type { Reservation } from '../../../../src/domain/reservation/reservation.js';
import { TypeOrmDailyMessageRepository } from '../../../../src/infrastructure/out/persistence/repositories/daily-message.repository.js';
import { TypeOrmDailySequenceRepository } from '../../../../src/infrastructure/out/persistence/repositories/daily-sequence.repository.js';
import { TypeOrmOtaRepository } from '../../../../src/infrastructure/out/persistence/repositories/ota.repository.js';
import { TypeOrmReservationRepository } from '../../../../src/infrastructure/out/persistence/repositories/reservation.repository.js';
import { TypeOrmTransactionRunner } from '../../../../src/infrastructure/out/persistence/typeorm-transaction.js';
import { aDirectReservation } from '../../../support/builders.js';
import {
  integrationEnv,
  openTestDataSource,
  truncateAllTables,
} from '../../support/database.js';
import { FakeDailyListPublisherModule } from '../../support/fake-daily-list-publisher.js';

/** El día operativo y la hora del ejemplo de UPDATED del plan: 2026-10-09 a las 09:15 de Colombia. */
const TODAY = '2026-10-09';
const CLOCK: Clock = {
  today: () => TODAY,
  now: () => new Date('2026-10-09T14:15:00.000Z'),
};
const COLOMBIA_MICROSECONDS =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}-05:00$/;

type SavedMessage = {
  sequence_number: number;
  update_type: string;
  reservation_id: string;
  payload: {
    sequenceNumber: number;
    reservationRef: string;
    reservation: { updatedAt: string };
  };
};

/**
 * `DailyListChangeRecorder` con los repositorios reales (plan de `check-view-reservation`, "Anotar un
 * cambio" y D3): el cambio de la reserva, la secuencia y el mensaje van en la misma transacción.
 */
describe('DailyListChangeRecorder contra PostgreSQL real', () => {
  let dataSource: DataSource;
  let reservations: TypeOrmReservationRepository;
  let transactions: TypeOrmTransactionRunner;
  let recorder: DailyListChangeRecorderService;

  /** Una reserva directa nueva con llegada hoy: entra a la lista con ADDED (escenario 1). */
  const arrivingToday = () =>
    aDirectReservation({ startDate: TODAY, endDate: '2026-10-12' });

  /** Crea la reserva y anota el cambio en una sola transacción, como `generate-direct-reservation`. */
  const create = (reservation: Reservation) =>
    transactions.run(async (tx) => {
      const saved = await reservations.insert(reservation, tx);
      await recorder.record(tx, null, saved);
      return saved;
    });

  const aDay = (lastSequence: number, listGenerated: boolean) =>
    dataSource.query(
      `INSERT INTO daily_sequence (operational_date, last_sequence, list_generated)
       VALUES ($1, $2, $3)`,
      [TODAY, lastSequence, listGenerated],
    );

  const savedMessages = (): Promise<SavedMessage[]> =>
    dataSource.query(
      `SELECT sequence_number, update_type, reservation_id::text, payload
       FROM daily_list_message ORDER BY sequence_number`,
    );

  const lastSequence = async (): Promise<number> => {
    const [{ last_sequence }]: { last_sequence: number }[] =
      await dataSource.query(
        'SELECT last_sequence FROM daily_sequence WHERE operational_date = $1',
        [TODAY],
      );
    return last_sequence;
  };

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    reservations = new TypeOrmReservationRepository(dataSource);
    transactions = new TypeOrmTransactionRunner(dataSource);
    recorder = new DailyListChangeRecorderService(
      new TypeOrmDailySequenceRepository(dataSource),
      new TypeOrmDailyMessageRepository(dataSource),
      new TypeOrmOtaRepository(dataSource),
      CLOCK,
    );
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('escenario 1: con la lista ya enviada, una reserva nueva para hoy deja su ADDED con la secuencia 2', async () => {
    await aDay(1, true);

    const saved = await create(arrivingToday());

    const [message] = await savedMessages();
    expect(message).toMatchObject({
      sequence_number: 2,
      update_type: 'ADDED',
      reservation_id: saved.id,
      payload: {
        sequenceNumber: 2,
        reservationRef: saved.reservationRef,
      },
    });
    // El updatedAt que puso la base, en hora de Colombia y con sus microsegundos.
    expect(message.payload.reservation.updatedAt).toMatch(
      COLOMBIA_MICROSECONDS,
    );
    expect(await lastSequence()).toBe(2);
  });

  it('dos reservas creadas a la vez toman secuencias distintas y seguidas, sin huecos', async () => {
    await aDay(1, true);

    const [first, second] = await Promise.all([
      create(arrivingToday()),
      create(arrivingToday()),
    ]);

    const saved = await savedMessages();
    expect(saved.map((message) => message.sequence_number)).toEqual([2, 3]);
    expect(saved.map((message) => message.reservation_id).sort()).toEqual(
      [first.id, second.id].sort(),
    );
    expect(await lastSequence()).toBe(3);
  });

  it('si el cambio de la reserva se revierte, no quedan ni el mensaje ni la secuencia', async () => {
    await aDay(1, true);

    await expect(
      transactions.run(async (tx) => {
        const saved = await reservations.insert(arrivingToday(), tx);
        await recorder.record(tx, null, saved);
        throw new Error('falla la reserva');
      }),
    ).rejects.toThrow('falla la reserva');

    expect(await savedMessages()).toEqual([]);
    expect(await lastSequence()).toBe(1);
  });

  it('caso borde: mientras la lista del día no sale, no deja nada', async () => {
    await aDay(0, false);

    await create(arrivingToday());

    expect(await savedMessages()).toEqual([]);
    expect(await lastSequence()).toBe(0);
  });
});

/** Un proveedor de fuera del módulo lo inyecta, como lo harán los demás casos de uso (regla 6). */
const INJECTED_RECORDER = Symbol('INJECTED_RECORDER');

describe('CheckViewReservationModule', () => {
  let moduleRef: TestingModule | undefined;

  beforeAll(async () => {
    // AppConfigModule lee el entorno al importarse: se importa después de asignarlo.
    Object.assign(process.env, { NODE_ENV: 'test', ...integrationEnv() });
    const { AppConfigModule } =
      await import('../../../../src/infrastructure/config/app-config.module.js');
    const { PersistenceModule } =
      await import('../../../../src/infrastructure/out/persistence/persistence.module.js');
    const { ClockModule } =
      await import('../../../../src/infrastructure/out/clock/clock.module.js');
    const { CheckViewReservationModule } =
      await import('../../../../src/application/use-cases/check-view-reservation/check-view-reservation.module.js');
    moduleRef = await Test.createTestingModule({
      imports: [
        AppConfigModule,
        PersistenceModule,
        ClockModule,
        FakeDailyListPublisherModule,
        CheckViewReservationModule,
      ],
      providers: [
        {
          provide: INJECTED_RECORDER,
          inject: [DAILY_LIST_CHANGE_RECORDER],
          useFactory: (recorder: unknown) => recorder,
        },
      ],
    }).compile();
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('exporta el recorder con sus repositorios de PersistenceModule y el reloj', () => {
    expect(moduleRef?.get(INJECTED_RECORDER)).toBeInstanceOf(
      DailyListChangeRecorderService,
    );
  });
});
