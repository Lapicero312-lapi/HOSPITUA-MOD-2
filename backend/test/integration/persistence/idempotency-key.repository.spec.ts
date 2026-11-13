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

describe('IdempotencyKeyRepository contra PostgreSQL real (T019 de generate-direct-reservation)', () => {
  let dataSource: DataSource;
  let keys: TypeOrmIdempotencyKeyRepository;
  let transactions: TypeOrmTransactionRunner;
  let reservation: Reservation;

  const save = (
    entry: { key: string; requestHash: string; reservationId: string },
    expiredBefore = new Date(Date.now() - 24 * 60 * 60 * 1000),
  ) => transactions.run((tx) => keys.save(tx, entry, expiredBefore));

  const ageKey = (key: string, hours: number) =>
    dataSource.query(
      `UPDATE idempotency_key SET created_at = now() - ($2 || ' hours')::interval WHERE key = $1`,
      [key, String(hours)],
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

  it('save y find: la clave, su hash, la referencia de su reserva y cuándo se creó', async () => {
    await save({ key: KEY, requestHash: HASH, reservationId: reservation.id });

    const stored = await keys.find(KEY);

    expect(stored).toMatchObject({
      requestHash: HASH,
      reservationRef: reservation.reservationRef,
    });
    expect(
      Math.abs((stored?.createdAt.getTime() ?? 0) - Date.now()),
    ).toBeLessThan(60_000);
  });

  it('find de una clave que no existe da null', async () => {
    expect(await keys.find(KEY)).toBeNull();
  });

  it('con una fila vigente con la misma clave, save lanza DuplicateIdempotencyKeyError y no la cambia', async () => {
    await save({ key: KEY, requestHash: HASH, reservationId: reservation.id });

    await expect(
      save({
        key: KEY,
        requestHash: 'b'.repeat(64),
        reservationId: reservation.id,
      }),
    ).rejects.toBeInstanceOf(DuplicateIdempotencyKeyError);
    expect((await keys.find(KEY))?.requestHash).toBe(HASH);
  });

  it('una fila vencida con la misma clave se reemplaza', async () => {
    await save({ key: KEY, requestHash: HASH, reservationId: reservation.id });
    await ageKey(KEY, 25);

    await save({
      key: KEY,
      requestHash: 'b'.repeat(64),
      reservationId: reservation.id,
    });

    expect((await keys.find(KEY))?.requestHash).toBe('b'.repeat(64));
  });

  it('si la transacción de la reserva se revierte, la clave no queda', async () => {
    await expect(
      transactions.run(async (tx) => {
        await keys.save(
          tx,
          { key: KEY, requestHash: HASH, reservationId: reservation.id },
          new Date(0),
        );
        throw new Error('se revierte');
      }),
    ).rejects.toThrow('se revierte');

    expect(await keys.find(KEY)).toBeNull();
  });

  it('deleteExpired borra solo las de antes del instante dado y devuelve cuántas', async () => {
    const old = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
    await save({ key: KEY, requestHash: HASH, reservationId: reservation.id });
    await save({ key: old, requestHash: HASH, reservationId: reservation.id });
    await ageKey(old, 30);

    const deleted = await keys.deleteExpired(
      new Date(Date.now() - 24 * 60 * 60 * 1000),
    );

    expect(deleted).toBe(1);
    expect(await keys.find(old)).toBeNull();
    expect(await keys.find(KEY)).not.toBeNull();
  });
});
