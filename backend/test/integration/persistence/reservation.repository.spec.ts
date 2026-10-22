import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DuplicateConfirmationCodeError,
  DuplicateReservationRefError,
  RoomOverlapError,
} from '../../../src/application/ports/out/reservation.repository.js';
import { Reservation } from '../../../src/domain/reservation/reservation.js';
import { ReservationRoom } from '../../../src/domain/reservation/reservation-room.js';
import { TypeOrmOtaRepository } from '../../../src/infrastructure/out/persistence/repositories/ota.repository.js';
import { TypeOrmReservationRepository } from '../../../src/infrastructure/out/persistence/repositories/reservation.repository.js';
import { TypeOrmTransactionRunner } from '../../../src/infrastructure/out/persistence/typeorm-transaction.js';
import {
  aDirectReservation,
  aDirectRoom,
  aGuest,
  anOta,
  anOtaReservation,
  anOtaRoom,
} from '../../support/builders.js';
import { openTestDataSource, truncateAllTables } from '../support/database.js';

describe('TypeOrmReservationRepository contra PostgreSQL real', () => {
  let dataSource: DataSource;
  let repository: TypeOrmReservationRepository;
  let transactions: TypeOrmTransactionRunner;

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    repository = new TypeOrmReservationRepository(dataSource);
    transactions = new TypeOrmTransactionRunner(dataSource);
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  /** El `updated_at` exacto de la base, como texto. */
  async function updatedAtInDatabase(id: string): Promise<string> {
    const [{ updated_at }] = await dataSource.query(
      'SELECT updated_at::text AS updated_at FROM reservation WHERE id = $1',
      [id],
    );
    return updated_at;
  }

  async function aSavedOta(): Promise<string> {
    const ota = anOta();
    await new TypeOrmOtaRepository(dataSource).insert(ota);
    return ota.id;
  }

  describe('insert y lectura', () => {
    it('guarda la reserva directa con sus habitaciones y su titular, y la lee igual', async () => {
      const reservation = aDirectReservation({
        rooms: [
          aDirectRoom({ roomNumber: '201' }),
          aDirectRoom({ roomNumber: '202' }),
        ],
      });

      const saved = await repository.insert(reservation);
      const read = await repository.findByRef(reservation.reservationRef);

      expect(read?.snapshot()).toEqual({
        ...reservation.snapshot(),
        createdAt: saved.createdAt,
        updatedAt: saved.updatedAt,
      });
      expect(saved.createdAt).toBeInstanceOf(Date);
      expect(await repository.findById(reservation.id)).toEqual(read);
    });

    it('guarda la copia de las fechas y blocks_inventory de cada habitación (D3)', async () => {
      const reservation = aDirectReservation();
      await repository.insert(reservation);

      const [room] = await dataSource.query(
        `SELECT start_date::text, end_date::text, blocks_inventory FROM reservation_room
         WHERE reservation_id = $1`,
        [reservation.id],
      );
      expect(room).toEqual({
        start_date: '2026-11-10',
        end_date: '2026-11-12',
        blocks_inventory: true,
      });
    });

    it('guarda una reserva de Booking en conflicto con una habitación sin asignar', async () => {
      const otaId = await aSavedOta();
      const reservation = anOtaReservation(otaId, {
        rooms: [anOtaRoom({ roomId: null, roomNumber: null })],
        conflict: {
          reason: 'NO_ROOM_AVAILABLE',
          detectedAt: new Date('2026-10-09T14:14:00.000Z'),
        },
      });

      await repository.insert(reservation);
      const read = await repository.findByRef(reservation.reservationRef);

      expect(read?.ota).toEqual(reservation.ota);
      expect(read?.conflict).toEqual(reservation.conflict);
      expect(read?.rooms[0].isAssigned).toBe(false);
      expect(read?.guest.documentNumber).toBeNull();
    });

    it('una referencia que no existe es null', async () => {
      expect(await repository.findByRef('RSV-00000000')).toBeNull();
    });
  });

  describe('restricciones de la base', () => {
    it('una habitación ocupada en esas fechas es RoomOverlapError y no guarda nada', async () => {
      const roomId = randomUUID();
      await repository.insert(
        aDirectReservation({ rooms: [aDirectRoom({ roomId })] }),
      );
      const other = aDirectReservation({
        startDate: '2026-11-11',
        endDate: '2026-11-14',
        rooms: [aDirectRoom({ roomId })],
      });

      await expect(repository.insert(other)).rejects.toBeInstanceOf(
        RoomOverlapError,
      );
      expect(await repository.findByRef(other.reservationRef)).toBeNull();
    });

    it('una referencia repetida es DuplicateReservationRefError', async () => {
      const first = aDirectReservation();
      await repository.insert(first);

      await expect(
        repository.insert(
          aDirectReservation({ reservationRef: first.reservationRef }),
        ),
      ).rejects.toBeInstanceOf(DuplicateReservationRefError);
    });

    it('el mismo código de confirmación en la misma agencia es DuplicateConfirmationCodeError', async () => {
      const otaId = await aSavedOta();
      await repository.insert(anOtaReservation(otaId));

      await expect(
        repository.insert(anOtaReservation(otaId)),
      ).rejects.toBeInstanceOf(DuplicateConfirmationCodeError);
    });
  });

  describe('update y control de concurrencia', () => {
    it('updatedAt conserva los microsegundos de la base', async () => {
      const saved = await repository.insert(aDirectReservation());

      expect(saved.updatedAt).toBe(await updatedAtInDatabase(saved.id));
    });

    it('guarda los cambios: datos, titular y habitaciones agregadas, cambiadas y quitadas', async () => {
      const kept = aDirectRoom({ roomNumber: '201' });
      const removed = aDirectRoom({ roomNumber: '202' });
      const saved = await repository.insert(
        aDirectReservation({ rooms: [kept, removed] }),
      );
      const added = aDirectRoom({ roomNumber: '305', guestCount: 1 });

      const updated = await repository.update(
        Reservation.restore({
          ...saved.snapshot(),
          endDate: '2026-11-13',
          notes: 'Cambio de fechas',
          guest: aGuest({ ...saved.guest.snapshot(), contactPhone: '+57 311' }),
          rooms: [
            ReservationRoom.restore({ ...kept.snapshot(), guestCount: 3 }),
            added,
          ],
        }),
      );

      const read = await repository.findByRef(saved.reservationRef);
      expect(read?.endDate).toBe('2026-11-13');
      expect(read?.notes).toBe('Cambio de fechas');
      expect(read?.guest.contactPhone).toBe('+57 311');
      expect(
        read?.rooms.map((room) => [room.roomNumber, room.guestCount]),
      ).toEqual([
        ['201', 3],
        ['305', 1],
      ]);
      expect(read?.guestCount).toBe(4);
      expect(updated.updatedAt).not.toBe(saved.updatedAt);
      const copies = await dataSource.query(
        'SELECT DISTINCT end_date::text AS end_date FROM reservation_room WHERE reservation_id = $1',
        [saved.id],
      );
      expect(copies).toEqual([{ end_date: '2026-11-13' }]);
    });

    it('con un updatedAt viejo responde CONCURRENT_UPDATE y no cambia nada', async () => {
      const saved = await repository.insert(aDirectReservation());
      await repository.update(
        Reservation.restore({ ...saved.snapshot(), notes: 'Primero' }),
      );

      await expect(
        repository.update(
          Reservation.restore({ ...saved.snapshot(), notes: 'Segundo' }),
        ),
      ).rejects.toMatchObject({
        errorCode: 'CONCURRENT_UPDATE',
        message: 'Esta reserva ya fue actualizada o cancelada recientemente',
      });
      expect((await repository.findById(saved.id))?.notes).toBe('Primero');
    });

    it('de dos cambios simultáneos con el mismo updatedAt, solo uno se guarda', async () => {
      const saved = await repository.insert(aDirectReservation());

      const results = await Promise.allSettled(
        ['A', 'B'].map((notes) =>
          repository.update(
            Reservation.restore({ ...saved.snapshot(), notes }),
          ),
        ),
      );

      expect(results.map((result) => result.status).sort()).toEqual([
        'fulfilled',
        'rejected',
      ]);
      const rejected = results.find((result) => result.status === 'rejected');
      expect(rejected?.reason).toMatchObject({
        errorCode: 'CONCURRENT_UPDATE',
      });
    });

    it('al cancelar, las habitaciones dejan de ocupar inventario y otra reserva puede tomarlas', async () => {
      const roomId = randomUUID();
      const saved = await repository.insert(
        aDirectReservation({ rooms: [aDirectRoom({ roomId })] }),
      );
      await repository.update(
        Reservation.restore({ ...saved.snapshot(), status: 'CANCELLED' }),
      );

      await expect(
        repository.insert(
          aDirectReservation({ rooms: [aDirectRoom({ roomId })] }),
        ),
      ).resolves.toBeInstanceOf(Reservation);
    });
  });

  describe('transacciones', () => {
    it('si la transacción falla, no queda nada guardado', async () => {
      const reservation = aDirectReservation();

      await expect(
        transactions.run(async (tx) => {
          await repository.insert(reservation, tx);
          throw new Error('fallo después de guardar');
        }),
      ).rejects.toThrow('fallo después de guardar');
      expect(await repository.findByRef(reservation.reservationRef)).toBeNull();
    });

    it('lockByRef lee y bloquea la reserva dentro de la transacción', async () => {
      const saved = await repository.insert(aDirectReservation());

      const locked = await transactions.run((tx) =>
        repository.lockByRef(saved.reservationRef, tx),
      );
      const missing = await transactions.run((tx) =>
        repository.lockByRef('RSV-00000000', tx),
      );

      expect(locked?.id).toBe(saved.id);
      expect(missing).toBeNull();
    });

    it('lockByRef hace esperar a otra transacción que quiere la misma reserva', async () => {
      const saved = await repository.insert(aDirectReservation());
      const order: string[] = [];
      let releaseFirst!: () => void;
      const firstHoldsLock = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });

      const first = transactions.run(async (tx) => {
        await repository.lockByRef(saved.reservationRef, tx);
        order.push('primera bloquea');
        await new Promise((resolve) => setTimeout(resolve, 300));
        order.push('primera termina');
        releaseFirst();
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      const second = transactions.run(async (tx) => {
        await repository.lockByRef(saved.reservationRef, tx);
        order.push('segunda bloquea');
      });

      await Promise.all([first, second, firstHoldsLock]);
      expect(order).toEqual([
        'primera bloquea',
        'primera termina',
        'segunda bloquea',
      ]);
    });
  });
});
