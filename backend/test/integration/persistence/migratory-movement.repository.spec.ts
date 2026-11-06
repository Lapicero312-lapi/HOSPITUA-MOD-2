import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GuestData } from '../../../src/domain/migration/guest-data.js';
import {
  MigratoryMovement,
  type MigratoryMovementProps,
} from '../../../src/domain/migration/migratory-movement.js';
import { TypeOrmGuestDataRepository } from '../../../src/infrastructure/out/persistence/repositories/guest-data.repository.js';
import { TypeOrmMigratoryMovementRepository } from '../../../src/infrastructure/out/persistence/repositories/migratory-movement.repository.js';
import { TypeOrmReservationRepository } from '../../../src/infrastructure/out/persistence/repositories/reservation.repository.js';
import { TypeOrmTransactionRunner } from '../../../src/infrastructure/out/persistence/typeorm-transaction.js';
import { aDirectReservation } from '../../support/builders.js';
import { openTestDataSource, truncateAllTables } from '../support/database.js';

describe('TypeOrmMigratoryMovementRepository contra PostgreSQL real', () => {
  let dataSource: DataSource;
  let movements: TypeOrmMigratoryMovementRepository;
  let transactions: TypeOrmTransactionRunner;
  let anaId: string;
  let johnId: string;

  /** Por defecto, la entrada de Ana del 2026-10-09 (mensaje de Check-In del plan de `update-reservation`). */
  const aMovement = (
    changes: Partial<MigratoryMovementProps> = {},
  ): MigratoryMovement =>
    MigratoryMovement.restore({
      id: randomUUID(),
      guestDataId: anaId,
      movementType: 'ENTRY',
      movementDate: '2026-10-09',
      ...changes,
    });

  const insertMissing = (list: MigratoryMovement[]) =>
    transactions.run((tx) => movements.insertMissing(list, tx));

  const rows = (): Promise<
    {
      id: string;
      guest_data_id: string;
      movement_type: string;
      movement_date: string;
    }[]
  > =>
    dataSource.query(
      `SELECT id::text, guest_data_id::text, movement_type, movement_date::text
       FROM migratory_movement ORDER BY movement_date, movement_type, guest_data_id`,
    );

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    movements = new TypeOrmMigratoryMovementRepository(dataSource);
    transactions = new TypeOrmTransactionRunner(dataSource);
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    const reservation = await new TypeOrmReservationRepository(
      dataSource,
    ).insert(aDirectReservation());
    const guest = (documentNumber: string, nationality: string) =>
      GuestData.restore({
        id: randomUUID(),
        reservationRef: reservation.reservationRef,
        firstName: 'Huésped',
        lastName: documentNumber,
        documentType: 'CC',
        documentNumber,
        birthDate: '1990-05-12',
        nationality,
        originPlace: null,
        destinationPlace: null,
      });
    const [ana, john] = await transactions.run((tx) =>
      new TypeOrmGuestDataRepository(dataSource).insertMissing(
        [guest('123', 'Colombia'), guest('X99', 'Estados Unidos')],
        tx,
      ),
    );
    anaId = ana.id;
    johnId = john.id;
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('guarda una entrada por huésped y dice cuántas se crearon', async () => {
    const entries = [aMovement(), aMovement({ guestDataId: johnId })];

    await expect(insertMissing(entries)).resolves.toBe(2);

    const saved = await rows();
    expect(saved).toHaveLength(2);
    expect(saved).toEqual(
      expect.arrayContaining(
        entries.map((entry) => ({
          id: entry.id,
          guest_data_id: entry.guestDataId,
          movement_type: 'ENTRY',
          movement_date: '2026-10-09',
        })),
      ),
    );
  });

  it('la notificación repetida no duplica ni cambia nada (escenario 5)', async () => {
    const first = aMovement();
    await insertMissing([first]);

    await expect(
      insertMissing([aMovement({ movementDate: '2026-10-10' })]),
    ).resolves.toBe(0);

    expect(await rows()).toEqual([
      {
        id: first.id,
        guest_data_id: anaId,
        movement_type: 'ENTRY',
        movement_date: '2026-10-09',
      },
    ]);
  });

  it('la salida se agrega sin tocar la entrada (escenario 3)', async () => {
    await insertMissing([aMovement()]);

    await expect(
      insertMissing([
        aMovement({ movementType: 'DEPARTURE', movementDate: '2026-10-12' }),
      ]),
    ).resolves.toBe(1);

    expect(
      (await rows()).map((row) => [row.movement_type, row.movement_date]),
    ).toEqual([
      ['ENTRY', '2026-10-09'],
      ['DEPARTURE', '2026-10-12'],
    ]);
  });

  it('con uno ya guardado y otro nuevo, cuenta solo el nuevo', async () => {
    await insertMissing([aMovement()]);

    await expect(
      insertMissing([aMovement(), aMovement({ guestDataId: johnId })]),
    ).resolves.toBe(1);

    expect(await rows()).toHaveLength(2);
  });

  it('si la transacción de quien llama se revierte, no queda ningún movimiento', async () => {
    await expect(
      transactions.run(async (tx) => {
        await movements.insertMissing([aMovement()], tx);
        throw new Error('falló el Check-In');
      }),
    ).rejects.toThrow('falló el Check-In');

    expect(await rows()).toHaveLength(0);
  });

  it('con una lista vacía no guarda nada', async () => {
    await expect(insertMissing([])).resolves.toBe(0);
  });
});
