import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { DailyMessage } from '../../../src/application/ports/out/daily-message.repository.js';
import type { Reservation } from '../../../src/domain/reservation/reservation.js';
import { TypeOrmDailyMessageRepository } from '../../../src/infrastructure/out/persistence/repositories/daily-message.repository.js';
import { TypeOrmDailySequenceRepository } from '../../../src/infrastructure/out/persistence/repositories/daily-sequence.repository.js';
import { TypeOrmReservationRepository } from '../../../src/infrastructure/out/persistence/repositories/reservation.repository.js';
import { TypeOrmTransactionRunner } from '../../../src/infrastructure/out/persistence/typeorm-transaction.js';
import { aDirectReservation } from '../../support/builders.js';
import { openTestDataSource, truncateAllTables } from '../support/database.js';

/** El día operativo del ejemplo de la lista del día del plan de `check-view-reservation`. */
const TODAY = '2026-10-09';
const MESSAGE_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

describe('Repositorios de la lista del día contra PostgreSQL real', () => {
  let dataSource: DataSource;
  let sequences: TypeOrmDailySequenceRepository;
  let messages: TypeOrmDailyMessageRepository;
  let transactions: TypeOrmTransactionRunner;
  let reservation: Reservation;

  const aDay = (lastSequence: number, listGenerated: boolean, day = TODAY) =>
    dataSource.query(
      `INSERT INTO daily_sequence (operational_date, last_sequence, list_generated)
       VALUES ($1, $2, $3)`,
      [day, lastSequence, listGenerated],
    );

  const lastSequenceOf = async (day: string): Promise<number> => {
    const [{ last_sequence }]: { last_sequence: number }[] =
      await dataSource.query(
        'SELECT last_sequence FROM daily_sequence WHERE operational_date = $1',
        [day],
      );
    return last_sequence;
  };

  /** Espera a que otra conexión quede bloqueada en el `FOR UPDATE` de `daily_sequence`. */
  async function waitForBlockedLock(): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt++) {
      const [{ blocked }]: { blocked: number }[] = await dataSource.query(
        `SELECT count(*)::int AS blocked FROM pg_stat_activity
         WHERE wait_event_type = 'Lock' AND pid <> pg_backend_pid()
           AND query LIKE '%FROM daily_sequence%FOR UPDATE%'`,
      );
      if (blocked > 0) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('El segundo bloqueo nunca esperó');
  }

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    sequences = new TypeOrmDailySequenceRepository(dataSource);
    messages = new TypeOrmDailyMessageRepository(dataSource);
    transactions = new TypeOrmTransactionRunner(dataSource);
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    reservation = await new TypeOrmReservationRepository(dataSource).insert(
      aDirectReservation({ startDate: TODAY, endDate: '2026-10-12' }),
    );
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  describe('DailySequenceRepository', () => {
    it('lockDay: sin la fila del día da null y no la crea', async () => {
      expect(
        await transactions.run((tx) => sequences.lockDay(TODAY, tx)),
      ).toBeNull();
      expect(await dataSource.query('SELECT * FROM daily_sequence')).toEqual(
        [],
      );
    });

    it('lockDay: devuelve la última secuencia y si la lista ya salió', async () => {
      await aDay(3, true);
      await aDay(0, false, '2026-10-10');

      expect(
        await transactions.run((tx) => sequences.lockDay(TODAY, tx)),
      ).toEqual({ lastSequence: 3, listGenerated: true });
      expect(
        await transactions.run((tx) => sequences.lockDay('2026-10-10', tx)),
      ).toEqual({ lastSequence: 0, listGenerated: false });
    });

    it('setLastSequence: guarda la secuencia del día y no toca los demás', async () => {
      await aDay(1, true);
      await aDay(5, true, '2026-10-08');

      await transactions.run((tx) => sequences.setLastSequence(TODAY, 2, tx));

      expect(await lastSequenceOf(TODAY)).toBe(2);
      expect(await lastSequenceOf('2026-10-08')).toBe(5);
    });

    it('el bloqueo serializa: la segunda transacción espera y lee la secuencia que guardó la primera', async () => {
      await aDay(1, true);
      let releaseFirst!: () => void;
      const firstMayCommit = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      let firstLocked!: () => void;
      const firstHasLock = new Promise<void>((resolve) => {
        firstLocked = resolve;
      });

      const first = transactions.run(async (tx) => {
        await sequences.lockDay(TODAY, tx);
        firstLocked();
        await firstMayCommit;
        await sequences.setLastSequence(TODAY, 2, tx);
      });
      await firstHasLock;
      const second = transactions.run((tx) => sequences.lockDay(TODAY, tx));
      await waitForBlockedLock();
      releaseFirst();
      await first;

      expect(await second).toEqual({ lastSequence: 2, listGenerated: true });
    });
  });

  describe('DailyMessageRepository', () => {
    const anUpdate = (changes: Partial<DailyMessage> = {}): DailyMessage => ({
      messageId: MESSAGE_ID,
      operationalDate: TODAY,
      sequenceNumber: 2,
      kind: 'UPDATE',
      updateType: 'REMOVED',
      reservationId: reservation.id,
      removalReason: 'CANCELLED',
      payload: {
        messageId: MESSAGE_ID,
        sequenceNumber: 2,
        operationalDate: TODAY,
        updateType: 'REMOVED',
        occurredAt: '2026-10-09T09:15:00-05:00',
        reservationRef: reservation.reservationRef,
        removalReason: 'CANCELLED',
      },
      ...changes,
    });

    const savedMessages = () =>
      dataSource.query(
        `SELECT message_id::text, operational_date::text, sequence_number, message_kind, update_type,
                reservation_id::text, removal_reason, payload, publish_status, attempts, published_at
         FROM daily_list_message ORDER BY sequence_number`,
      );

    it('guarda el mensaje en PENDING, sin intentos ni publicación, con el payload tal como se publica', async () => {
      const message = anUpdate();

      await transactions.run((tx) => messages.insert(message, tx));

      expect(await savedMessages()).toEqual([
        {
          message_id: MESSAGE_ID,
          operational_date: TODAY,
          sequence_number: 2,
          message_kind: 'UPDATE',
          update_type: 'REMOVED',
          reservation_id: reservation.id,
          removal_reason: 'CANCELLED',
          payload: message.payload,
          publish_status: 'PENDING',
          attempts: 0,
          published_at: null,
        },
      ]);
    });

    it('un ADDED va sin motivo', async () => {
      await transactions.run((tx) =>
        messages.insert(
          anUpdate({
            updateType: 'ADDED',
            removalReason: null,
            payload: { updateType: 'ADDED' },
          }),
          tx,
        ),
      );

      expect(await savedMessages()).toMatchObject([
        { update_type: 'ADDED', removal_reason: null },
      ]);
    });

    it('si la transacción del cambio se revierte, el mensaje no queda', async () => {
      await expect(
        transactions.run(async (tx) => {
          await messages.insert(anUpdate(), tx);
          throw new Error('falla el cambio de la reserva');
        }),
      ).rejects.toThrow('falla el cambio de la reserva');

      expect(await savedMessages()).toEqual([]);
    });

    it('la base rechaza dos mensajes con la misma secuencia en el día', async () => {
      await transactions.run((tx) => messages.insert(anUpdate(), tx));

      await expect(
        transactions.run((tx) =>
          messages.insert(
            anUpdate({ messageId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479' }),
            tx,
          ),
        ),
      ).rejects.toThrow();
      expect(await savedMessages()).toHaveLength(1);
    });
  });
});
