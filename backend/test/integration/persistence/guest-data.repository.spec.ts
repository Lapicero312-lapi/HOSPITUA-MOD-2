import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  GuestData,
  type GuestDataProps,
} from '../../../src/domain/migration/guest-data.js';
import type { Reservation } from '../../../src/domain/reservation/reservation.js';
import { TypeOrmGuestDataRepository } from '../../../src/infrastructure/out/persistence/repositories/guest-data.repository.js';
import { TypeOrmReservationRepository } from '../../../src/infrastructure/out/persistence/repositories/reservation.repository.js';
import { TypeOrmTransactionRunner } from '../../../src/infrastructure/out/persistence/typeorm-transaction.js';
import { aDirectReservation } from '../../support/builders.js';
import { openTestDataSource, truncateAllTables } from '../support/database.js';

describe('TypeOrmGuestDataRepository contra PostgreSQL real', () => {
  let dataSource: DataSource;
  let guestData: TypeOrmGuestDataRepository;
  let transactions: TypeOrmTransactionRunner;
  let reservation: Reservation;
  let otherReservation: Reservation;

  /** Ana, colombiana, del mensaje de Check-In del plan de `update-reservation`. */
  const ana = (changes: Partial<GuestDataProps> = {}): GuestData =>
    GuestData.restore({
      id: randomUUID(),
      reservationRef: reservation.reservationRef,
      firstName: 'Ana',
      lastName: 'Pérez',
      documentType: 'CC',
      documentNumber: '123',
      birthDate: '1995-03-20',
      nationality: 'Colombia',
      originPlace: null,
      destinationPlace: null,
      ...changes,
    });

  /** John, extranjero, del mismo mensaje. */
  const john = (changes: Partial<GuestDataProps> = {}): GuestData =>
    GuestData.restore({
      id: randomUUID(),
      reservationRef: reservation.reservationRef,
      firstName: 'John',
      lastName: 'Smith',
      documentType: 'PAS',
      documentNumber: 'X99',
      birthDate: '1990-05-12',
      nationality: 'Estados Unidos',
      originPlace: 'Miami, Estados Unidos',
      destinationPlace: 'Cartagena, Colombia',
      ...changes,
    });

  const insertMissing = (guests: GuestData[]) =>
    transactions.run((tx) => guestData.insertMissing(guests, tx));

  const snapshots = (guests: GuestData[]) => guests.map((g) => g.snapshot());

  const count = async (): Promise<number> => {
    const [{ total }]: { total: number }[] = await dataSource.query(
      'SELECT count(*)::int AS total FROM guest_data',
    );
    return total;
  };

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    guestData = new TypeOrmGuestDataRepository(dataSource);
    transactions = new TypeOrmTransactionRunner(dataSource);
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    const reservations = new TypeOrmReservationRepository(dataSource);
    reservation = await reservations.insert(aDirectReservation());
    otherReservation = await reservations.insert(aDirectReservation());
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('guarda los huéspedes nuevos y los devuelve con todos sus datos', async () => {
    const guests = [ana(), john()];

    const saved = await insertMissing(guests);

    expect(snapshots(saved)).toEqual(snapshots(guests));
    expect(await count()).toBe(2);
  });

  it('un huésped que ya existe en la reserva no se modifica: devuelve el guardado (escenario 3a)', async () => {
    const [stored] = await insertMissing([ana()]);

    // El Check-Out trae datos distintos del mismo documento.
    const [again] = await insertMissing([
      ana({ lastName: 'Pérez Gómez', nationality: 'Venezuela' }),
    ]);

    expect(again.snapshot()).toEqual(stored.snapshot());
    expect(await count()).toBe(1);
  });

  it('con uno guardado y otro nuevo, devuelve los dos en el orden de la lista', async () => {
    const [stored] = await insertMissing([ana()]);
    const newcomer = john();

    const saved = await insertMissing([newcomer, ana()]);

    expect(snapshots(saved)).toEqual(snapshots([newcomer, stored]));
    expect(await count()).toBe(2);
  });

  it('el único es por reserva y número, sin el tipo de documento', async () => {
    const [stored] = await insertMissing([ana()]);

    const [again] = await insertMissing([ana({ documentType: 'PAS' })]);

    expect(again.snapshot()).toEqual(stored.snapshot());
    expect(await count()).toBe(1);
  });

  it('el mismo huésped en otra reserva es otra estadía: se guarda aparte', async () => {
    const [first] = await insertMissing([ana()]);

    const [second] = await insertMissing([
      ana({ reservationRef: otherReservation.reservationRef }),
    ]);

    expect(second.id).not.toBe(first.id);
    expect(second.reservationRef).toBe(otherReservation.reservationRef);
    expect(await count()).toBe(2);
  });

  it('si la transacción de quien llama se revierte, no queda ningún huésped', async () => {
    await expect(
      transactions.run(async (tx) => {
        await guestData.insertMissing([ana(), john()], tx);
        throw new Error('falló el Check-In');
      }),
    ).rejects.toThrow('falló el Check-In');

    expect(await count()).toBe(0);
  });

  it('con una lista vacía no guarda nada', async () => {
    await expect(insertMissing([])).resolves.toEqual([]);
  });

  it('con una reserva que no existe falla sin guardar nada', async () => {
    await expect(
      insertMissing([john(), ana({ reservationRef: 'RSV-00000000' })]),
    ).rejects.toThrow('La reserva RSV-00000000 no existe.');

    expect(await count()).toBe(0);
  });
});
