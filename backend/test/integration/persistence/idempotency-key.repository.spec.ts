import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DuplicateIdempotencyKeyError } from '../../../src/application/ports/out/idempotency-key.repository.js';
import type { Reservation } from '../../../src/domain/reservation/reservation.js';
import { TypeOrmIdempotencyKeyRepository } from '../../../src/infrastructure/out/persistence/repositories/idempotency-key.repository.js';
import { TypeOrmReservationRepository } from '../../../src/infrastructure/out/persistence/repositories/reservation.repository.js';
import { TypeOrmTransactionRunner } from '../../../src/infrastructure/out/persistence/typeorm-transaction.js';
import { aDirectReservation } from '../../support/builders.js';
import { openTestDataSource, truncateAllTables } from '../support/database.js';

const KEY = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const HASH = 'a'.repeat(64);
const OTHER_HASH = 'b'.repeat(64);

/** La hora del reloj de la aplicación al guardar: lejos de la hora real, como en las e2e. */
const CREATED_AT = new Date('2031-06-10T15:00:00.123Z');
const DAY_MS = 24 * 60 * 60 * 1000;
/** `Clock.now()` menos 24 horas, un día después de `CREATED_AT`: la clave vence justo ahí. */
const EXACTLY_EXPIRED = new Date(CREATED_AT.getTime());
const STILL_VALID = new Date(CREATED_AT.getTime() - 1);

describe('IdempotencyKeyRepository contra PostgreSQL real (T019 de generate-direct-reservation)', () => {
  let dataSource: DataSource;
  let keys: TypeOrmIdempotencyKeyRepository;
  let transactions: TypeOrmTransactionRunner;
  let reservation: Reservation;

  const save = (
    changes: { key?: string; requestHash?: string; createdAt?: Date } = {},
    expiredBefore = STILL_VALID,
  ) =>
    transactions.run((tx) =>
      keys.save(
        tx,
        {
          key: KEY,
          requestHash: HASH,
          reservationId: reservation.id,
          createdAt: CREATED_AT,
          ...changes,
        },
        expiredBefore,
      ),
    );

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    keys = new TypeOrmIdempotencyKeyRepository(dataSource);
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

  it('save y find: la clave, su hash, la referencia de su reserva y el createdAt que se le pasó, no la hora de la base', async () => {
    await save();

    expect(await keys.find(KEY)).toEqual({
      requestHash: HASH,
      reservationRef: reservation.reservationRef,
      createdAt: CREATED_AT,
    });
  });

  it('find de una clave que no existe da null', async () => {
    expect(await keys.find(KEY)).toBeNull();
  });

  it('con una fila vigente con la misma clave (1 ms antes de vencer), save lanza DuplicateIdempotencyKeyError y no la cambia', async () => {
    await save();

    await expect(
      save(
        {
          requestHash: OTHER_HASH,
          createdAt: new Date(CREATED_AT.getTime() + DAY_MS - 1),
        },
        STILL_VALID,
      ),
    ).rejects.toBeInstanceOf(DuplicateIdempotencyKeyError);
    expect(await keys.find(KEY)).toMatchObject({
      requestHash: HASH,
      createdAt: CREATED_AT,
    });
  });

  it('una fila que vence justo en expiredBefore (exactamente 24 horas) se reemplaza, con su createdAt nuevo', async () => {
    await save();
    const replacedAt = new Date(CREATED_AT.getTime() + DAY_MS);

    await save(
      { requestHash: OTHER_HASH, createdAt: replacedAt },
      EXACTLY_EXPIRED,
    );

    expect(await keys.find(KEY)).toMatchObject({
      requestHash: OTHER_HASH,
      createdAt: replacedAt,
    });
  });

  it('si la transacción de la reserva se revierte, la clave no queda', async () => {
    await expect(
      transactions.run(async (tx) => {
        await keys.save(
          tx,
          {
            key: KEY,
            requestHash: HASH,
            reservationId: reservation.id,
            createdAt: CREATED_AT,
          },
          STILL_VALID,
        );
        throw new Error('se revierte');
      }),
    ).rejects.toThrow('se revierte');

    expect(await keys.find(KEY)).toBeNull();
  });

  it('deleteExpired borra solo las creadas antes del instante dado (no la de ese mismo instante) y devuelve cuántas', async () => {
    const old = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
    await save();
    await save({ key: old, createdAt: new Date(CREATED_AT.getTime() - 1) });

    const deleted = await keys.deleteExpired(CREATED_AT);

    expect(deleted).toBe(1);
    expect(await keys.find(old)).toBeNull();
    expect(await keys.find(KEY)).not.toBeNull();
  });
});
