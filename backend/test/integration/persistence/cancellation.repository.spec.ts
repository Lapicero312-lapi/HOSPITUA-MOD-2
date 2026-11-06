import { randomUUID } from 'node:crypto';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { QueryFailedError, type DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CANCELLATION_REPOSITORY,
  DuplicateCancellationError,
} from '../../../src/application/ports/out/cancellation.repository.js';
import {
  Cancellation,
  type CancellationProps,
} from '../../../src/domain/cancellation/cancellation.js';
import type { Reservation } from '../../../src/domain/reservation/reservation.js';
import { TypeOrmCancellationRepository } from '../../../src/infrastructure/out/persistence/repositories/cancellation.repository.js';
import { TypeOrmReservationRepository } from '../../../src/infrastructure/out/persistence/repositories/reservation.repository.js';
import { TypeOrmTransactionRunner } from '../../../src/infrastructure/out/persistence/typeorm-transaction.js';
import { aDirectReservation } from '../../support/builders.js';
import {
  integrationEnv,
  openTestDataSource,
  truncateAllTables,
} from '../support/database.js';

const CANCELLED_AT = new Date('2026-10-09T14:30:00.000Z');

/** Una fila de `cancellation` tal como la guardó la base. */
type CancellationRow = {
  id: string;
  reservation_id: string;
  cancellation_date: string;
  reason: string | null;
  channel: string;
  processed_by: string;
  status: string;
};

describe('TypeOrmCancellationRepository contra PostgreSQL real (cancel-reservation, T001)', () => {
  let dataSource: DataSource;
  let cancellations: TypeOrmCancellationRepository;
  let transactions: TypeOrmTransactionRunner;
  let reservation: Reservation;

  /** La cancelación de la Recepcionista (canal `RECEPTION`) de la reserva de la prueba. */
  const aCancellation = (changes: Partial<CancellationProps> = {}) =>
    Cancellation.restore({
      id: randomUUID(),
      reservationRef: reservation.reservationRef,
      cancellationDate: CANCELLED_AT,
      reason: 'El huésped cambió de planes',
      channel: 'RECEPTION',
      processedBy: 'Laura Gómez',
      status: 'COMPLETED',
      ...changes,
    });

  const insert = (cancellation: Cancellation) =>
    transactions.run((tx) => cancellations.insert(cancellation, tx));

  const rows = (): Promise<CancellationRow[]> =>
    dataSource.query(
      `SELECT id::text, reservation_id::text, cancellation_date::text, reason, channel,
              processed_by, status
       FROM cancellation`,
    );

  /** Espera a que otra conexión quede bloqueada insertando en `cancellation`. */
  async function waitForBlockedInsert(): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt++) {
      const [{ blocked }]: { blocked: number }[] = await dataSource.query(
        `SELECT count(*)::int AS blocked FROM pg_stat_activity
         WHERE wait_event_type = 'Lock' AND pid <> pg_backend_pid()
           AND query LIKE '%INSERT INTO cancellation%'`,
      );
      if (blocked > 0) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('La segunda inserción nunca quedó bloqueada');
  }

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    cancellations = new TypeOrmCancellationRepository(dataSource);
    transactions = new TypeOrmTransactionRunner(dataSource);
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    reservation = await new TypeOrmReservationRepository(dataSource).insert(
      aDirectReservation(),
    );
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('guarda la cancelación de la Recepcionista con la reserva, la fecha, el motivo, el canal y quién la procesó', async () => {
    const cancellation = aCancellation();

    await insert(cancellation);

    const [row] = await rows();
    expect(row).toMatchObject({
      id: cancellation.id,
      reservation_id: reservation.id,
      reason: 'El huésped cambió de planes',
      channel: 'RECEPTION',
      processed_by: 'Laura Gómez',
      status: 'COMPLETED',
    });
    expect(new Date(row.cancellation_date)).toEqual(CANCELLED_AT);
  });

  it('la de Booking va por OTA_API, procesada por Booking.com y sin motivo', async () => {
    await insert(
      aCancellation({
        channel: 'OTA_API',
        processedBy: 'Booking.com',
        reason: null,
      }),
    );

    expect(await rows()).toMatchObject([
      { channel: 'OTA_API', processed_by: 'Booking.com', reason: null },
    ]);
  });

  describe('una sola cancelación por reserva (regla 5)', () => {
    it('la segunda de la misma reserva es DuplicateCancellationError y no deja otra fila', async () => {
      await insert(aCancellation());

      await expect(insert(aCancellation())).rejects.toEqual(
        new DuplicateCancellationError(reservation.reservationRef),
      );
      expect(await rows()).toHaveLength(1);
    });

    it('con dos a la vez, la restricción única deja pasar una y rechaza la otra', async () => {
      let releaseFirst!: () => void;
      const firstMayCommit = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      let firstInserted!: () => void;
      const firstHasInserted = new Promise<void>((resolve) => {
        firstInserted = resolve;
      });

      const first = transactions.run(async (tx) => {
        await cancellations.insert(aCancellation(), tx);
        firstInserted();
        await firstMayCommit;
      });
      await firstHasInserted;
      const second = insert(aCancellation());
      await waitForBlockedInsert();
      releaseFirst();

      await first;
      await expect(second).rejects.toBeInstanceOf(DuplicateCancellationError);
      expect(await rows()).toHaveLength(1);
    });

    it('cancelaciones de reservas distintas conviven', async () => {
      const other = await new TypeOrmReservationRepository(dataSource).insert(
        aDirectReservation(),
      );

      await insert(aCancellation());
      await insert(aCancellation({ reservationRef: other.reservationRef }));

      expect(await rows()).toHaveLength(2);
    });
  });

  it('una reserva que no existe es un error del programa y no guarda nada', async () => {
    await expect(
      insert(aCancellation({ reservationRef: 'RSV-00000000' })),
    ).rejects.toThrow('La reserva RSV-00000000 no existe.');
    expect(await rows()).toEqual([]);
  });

  it('si la transacción de la cancelación se revierte, la fila no queda', async () => {
    await expect(
      transactions.run(async (tx) => {
        await cancellations.insert(aCancellation(), tx);
        throw new Error('falla el cambio de estado');
      }),
    ).rejects.toThrow('falla el cambio de estado');

    expect(await rows()).toEqual([]);
  });

  it('la base solo acepta los canales RECEPTION y OTA_API', async () => {
    await expect(
      insert(aCancellation({ channel: 'EMAIL' as 'RECEPTION' })),
    ).rejects.toBeInstanceOf(QueryFailedError);
  });
});

/** Un proveedor de fuera de `PersistenceModule` lo inyecta, como lo hará `CancelReservation`. */
const INJECTED_CANCELLATIONS = Symbol('INJECTED_CANCELLATIONS');

describe('PersistenceModule exporta CancellationRepository', () => {
  let moduleRef: TestingModule | undefined;

  beforeAll(async () => {
    // AppConfigModule lee el entorno al importarse: se importa después de asignarlo.
    Object.assign(process.env, { NODE_ENV: 'test', ...integrationEnv() });
    const { AppConfigModule } =
      await import('../../../src/infrastructure/config/app-config.module.js');
    const { PersistenceModule } =
      await import('../../../src/infrastructure/out/persistence/persistence.module.js');
    moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, PersistenceModule],
      providers: [
        {
          provide: INJECTED_CANCELLATIONS,
          inject: [CANCELLATION_REPOSITORY],
          useFactory: (repository: unknown) => repository,
        },
      ],
    }).compile();
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('un caso de uso lo puede inyectar', () => {
    expect(moduleRef?.get(INJECTED_CANCELLATIONS)).toBeInstanceOf(
      TypeOrmCancellationRepository,
    );
  });
});
