import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ReservationStatusService } from '../../../../src/application/use-cases/update-reservation/reservation-status.service.js';
import { TypeOrmReservationRepository } from '../../../../src/infrastructure/out/persistence/repositories/reservation.repository.js';
import { TypeOrmTransactionRunner } from '../../../../src/infrastructure/out/persistence/typeorm-transaction.js';
import { aDirectReservation, aDirectRoom } from '../../../support/builders.js';
import {
  openTestDataSource,
  truncateAllTables,
} from '../../support/database.js';

describe('ReservationStatusService contra PostgreSQL real', () => {
  let dataSource: DataSource;
  let repository: TypeOrmReservationRepository;
  let service: ReservationStatusService;
  let transactions: TypeOrmTransactionRunner;

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    repository = new TypeOrmReservationRepository(dataSource);
    service = new ReservationStatusService(repository);
    transactions = new TypeOrmTransactionRunner(dataSource);
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  async function blocksInventory(reservationId: string): Promise<boolean[]> {
    const rows: { blocks_inventory: boolean }[] = await dataSource.query(
      'SELECT blocks_inventory FROM reservation_room WHERE reservation_id = $1 ORDER BY room_number',
      [reservationId],
    );
    return rows.map((row) => row.blocks_inventory);
  }

  it('Check-In y Check-Out de una habitación: ACTIVE → IN_PROGRESS → COMPLETED', async () => {
    const room = aDirectRoom();
    const saved = await repository.insert(
      aDirectReservation({ rooms: [room] }),
    );

    const completed = await transactions.run(async (tx) => {
      const checkedIn = await service.transitionStay(
        tx,
        saved,
        room.roomId!,
        'CHECKED_IN',
      );
      const inProgress = await service.transition(
        tx,
        checkedIn,
        'IN_PROGRESS',
        'CHECK_IN',
      );
      const checkedOut = await service.transitionStay(
        tx,
        inProgress,
        room.roomId!,
        'CHECKED_OUT',
      );
      return service.transition(tx, checkedOut, 'COMPLETED', 'CHECK_OUT');
    });

    const read = await repository.findById(saved.id);
    expect(read?.status).toBe('COMPLETED');
    expect(read?.statusReason).toBe('CHECK_OUT');
    expect(read?.rooms[0].stayStatus).toBe('CHECKED_OUT');
    expect(read?.updatedAt).toBe(completed.updatedAt);
    expect(await blocksInventory(saved.id)).toEqual([false]);
  });

  it('NO_SHOW deja todas las habitaciones en NOT_ARRIVED y libera el inventario (FR-019)', async () => {
    const roomId = randomUUID();
    const saved = await repository.insert(
      aDirectReservation({
        rooms: [
          aDirectRoom({ roomId, roomNumber: '201' }),
          aDirectRoom({ roomNumber: '202' }),
        ],
      }),
    );

    await transactions.run((tx) =>
      service.transition(tx, saved, 'NO_SHOW', 'DAY_CLOSE_NO_SHOW'),
    );

    const read = await repository.findById(saved.id);
    expect(read?.status).toBe('NO_SHOW');
    expect(read?.rooms.map((room) => room.stayStatus)).toEqual([
      'NOT_ARRIVED',
      'NOT_ARRIVED',
    ]);
    expect(await blocksInventory(saved.id)).toEqual([false, false]);
    // La habitación liberada se puede reservar en las mismas fechas.
    await expect(
      repository.insert(
        aDirectReservation({ rooms: [aDirectRoom({ roomId })] }),
      ),
    ).resolves.toBeDefined();
  });

  it('con una reserva leída antes de otro cambio responde CONCURRENT_UPDATE y no cambia nada', async () => {
    const saved = await repository.insert(aDirectReservation());
    await transactions.run((tx) =>
      service.transition(tx, saved, 'CANCELLED', 'CANCELLED_BY_RECEPTION'),
    );

    await expect(
      transactions.run((tx) =>
        service.transition(tx, saved, 'NO_SHOW', 'DAY_CLOSE_NO_SHOW'),
      ),
    ).rejects.toMatchObject({ errorCode: 'CONCURRENT_UPDATE' });
    expect((await repository.findById(saved.id))?.status).toBe('CANCELLED');
  });
});
