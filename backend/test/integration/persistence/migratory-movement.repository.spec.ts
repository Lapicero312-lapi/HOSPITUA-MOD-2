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
  let reservationRef: string;

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
    reservationRef = reservation.reservationRef;
    const guest = (
      documentNumber: string,
      nationality: string,
      places: { originPlace: string; destinationPlace: string } | null = null,
    ) =>
      GuestData.restore({
        id: randomUUID(),
        reservationRef: reservation.reservationRef,
        firstName: 'Huésped',
        lastName: documentNumber,
        documentType: 'CC',
        documentNumber,
        birthDate: '1990-05-12',
        nationality,
        originPlace: places?.originPlace ?? null,
        destinationPlace: places?.destinationPlace ?? null,
      });
    const [ana, john] = await transactions.run((tx) =>
      new TypeOrmGuestDataRepository(dataSource).insertMissing(
        [
          guest('123', 'Colombia'),
          guest('X99', 'Estados Unidos', {
            originPlace: 'Miami, Estados Unidos',
            destinationPlace: 'Cartagena, Colombia',
          }),
        ],
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

  describe('lecturas con el huésped (T012)', () => {
    /** La entrada de Ana y de John el 2026-10-09 y la salida de John el 2026-10-12. */
    async function insertStay(): Promise<{
      anaEntry: MigratoryMovement;
      johnEntry: MigratoryMovement;
      johnDeparture: MigratoryMovement;
    }> {
      const anaEntry = aMovement();
      const johnEntry = aMovement({ guestDataId: johnId });
      const johnDeparture = aMovement({
        guestDataId: johnId,
        movementType: 'DEPARTURE',
        movementDate: '2026-10-12',
      });
      await insertMissing([anaEntry, johnEntry, johnDeparture]);
      return { anaEntry, johnEntry, johnDeparture };
    }

    it('findWithGuestById devuelve el movimiento con su reserva y todos los datos del huésped, tal como se guardaron', async () => {
      const { johnDeparture } = await insertStay();

      await expect(
        movements.findWithGuestById(johnDeparture.id),
      ).resolves.toEqual({
        movementId: johnDeparture.id,
        reservationRef,
        movementType: 'DEPARTURE',
        movementDate: '2026-10-12',
        guest: {
          firstName: 'Huésped',
          lastName: 'X99',
          documentType: 'CC',
          documentNumber: 'X99',
          birthDate: '1990-05-12',
          nationality: 'Estados Unidos',
          originPlace: 'Miami, Estados Unidos',
          destinationPlace: 'Cartagena, Colombia',
        },
      });
    });

    it('findWithGuestById con un id que no existe es null', async () => {
      await insertStay();

      await expect(
        movements.findWithGuestById(randomUUID()),
      ).resolves.toBeNull();
    });

    it('findWithGuestByPeriod trae los movimientos del periodo de cualquier nacionalidad, con los vacíos como null', async () => {
      const { anaEntry, johnEntry, johnDeparture } = await insertStay();

      const found = await movements.findWithGuestByPeriod(
        '2026-10-09',
        '2026-10-12',
      );

      expect(found.map((movement) => movement.movementId).sort()).toEqual(
        [anaEntry.id, johnEntry.id, johnDeparture.id].sort(),
      );
      const ana = found.find((movement) => movement.movementId === anaEntry.id);
      expect(ana?.guest).toMatchObject({
        nationality: 'Colombia',
        originPlace: null,
        destinationPlace: null,
      });
    });

    it.each([
      [
        'los dos extremos incluidos: un solo día al principio',
        '2026-10-09',
        '2026-10-09',
        2,
      ],
      [
        'los dos extremos incluidos: un solo día al final',
        '2026-10-12',
        '2026-10-12',
        1,
      ],
      ['un periodo entre los dos movimientos', '2026-10-10', '2026-10-11', 0],
      ['un periodo que empieza después', '2026-10-13', '2026-10-31', 0],
    ])('findWithGuestByPeriod: %s', async (_caso, from, to, count) => {
      await insertStay();

      await expect(
        movements.findWithGuestByPeriod(from, to),
      ).resolves.toHaveLength(count);
    });
  });
});
