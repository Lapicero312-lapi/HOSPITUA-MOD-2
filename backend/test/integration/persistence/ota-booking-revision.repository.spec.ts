import { QueryFailedError, type DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DuplicateOtaBookingRevisionError,
  type ProcessedRevision,
} from '../../../src/application/ports/out/ota-booking-revision.repository.js';
import type { Ota } from '../../../src/domain/ota/ota.js';
import { TypeOrmOtaBookingRevisionRepository } from '../../../src/infrastructure/out/persistence/repositories/ota-booking-revision.repository.js';
import { TypeOrmOtaRepository } from '../../../src/infrastructure/out/persistence/repositories/ota.repository.js';
import { TypeOrmReservationRepository } from '../../../src/infrastructure/out/persistence/repositories/reservation.repository.js';
import { TypeOrmTransactionRunner } from '../../../src/infrastructure/out/persistence/typeorm-transaction.js';
import { anOta, anOtaReservation } from '../../support/builders.js';
import { openTestDataSource, truncateAllTables } from '../support/database.js';

/** Los ids de la revisión del ejemplo de A1 del plan de `generate-ota-reservation`. */
const REVISION_ID = '03dd7198-c5b7-493c-a889-74d0c2211de7';
const BOOKING_ID = 'cfa33f3b-bd32-4b90-8ef9-bde2bfe986cd';
const OTHER_REVISION_ID = '5b8e2f61-0c4a-4d3e-9f27-81a6c0d4e9b2';

type NewRevision = Omit<ProcessedRevision, 'processedAt' | 'ackedAt'>;

describe('TypeOrmOtaBookingRevisionRepository contra PostgreSQL real', () => {
  let dataSource: DataSource;
  let revisions: TypeOrmOtaBookingRevisionRepository;
  let transactions: TypeOrmTransactionRunner;
  let ota: Ota;

  /**
   * Por defecto, una cancelación de una reserva que el sistema no tiene: se registra `IGNORED` y sin
   * reserva (B3). Una `APPLIED` o una `CONFLICT` siempre tienen reserva (B1 y B2).
   */
  const aRevision = (changes: Partial<NewRevision> = {}): NewRevision => ({
    revisionId: REVISION_ID,
    otaId: ota.id,
    bookingId: BOOKING_ID,
    status: 'cancelled',
    reservationId: null,
    result: 'IGNORED',
    ...changes,
  });

  /**
   * Espera a que otra conexión quede bloqueada insertando en `ota_booking_revision`, para que la prueba
   * de concurrencia pruebe de verdad el caso.
   */
  async function waitForBlockedInsert(): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt++) {
      const [{ blocked }]: { blocked: number }[] = await dataSource.query(
        `SELECT count(*)::int AS blocked FROM pg_stat_activity
         WHERE wait_event_type = 'Lock' AND pid <> pg_backend_pid()
           AND query LIKE '%INSERT INTO ota_booking_revision%'`,
      );
      if (blocked > 0) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('La segunda inserción nunca quedó bloqueada');
  }

  const record = (revision: NewRevision) =>
    transactions.run((tx) => revisions.record(revision, tx));

  /** Las horas tal como las guardó la base, para comparar sin pasar por `Date`. */
  const timesOf = async (revisionId: string) => {
    const [row]: { processed_at: string; acked_at: string | null }[] =
      await dataSource.query(
        'SELECT processed_at, acked_at FROM ota_booking_revision WHERE revision_id = $1',
        [revisionId],
      );
    return row;
  };

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    revisions = new TypeOrmOtaBookingRevisionRepository(dataSource);
    transactions = new TypeOrmTransactionRunner(dataSource);
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    ota = await new TypeOrmOtaRepository(dataSource).insert(anOta());
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  describe('findById y record', () => {
    it('una revisión que nunca se procesó no está', async () => {
      await expect(revisions.findById(REVISION_ID)).resolves.toBeNull();
    });

    it('registra la revisión con la hora de la base y sin ack', async () => {
      const before = new Date();
      await record(aRevision());

      const saved = await revisions.findById(REVISION_ID);
      expect(saved).toEqual({
        revisionId: REVISION_ID,
        otaId: ota.id,
        bookingId: BOOKING_ID,
        status: 'cancelled',
        reservationId: null,
        result: 'IGNORED',
        processedAt: expect.any(Date) as Date,
        ackedAt: null,
      });
      // La hora la pone la base: está entre antes y después de registrarla, con unos ms de margen.
      expect(saved?.processedAt.getTime()).toBeGreaterThanOrEqual(
        before.getTime() - 1_000,
      );
      expect(saved?.processedAt.getTime()).toBeLessThanOrEqual(
        Date.now() + 1_000,
      );
    });

    it.each([
      ['new', 'APPLIED'],
      ['new', 'CONFLICT'],
      ['modified', 'APPLIED'],
      ['modified', 'CONFLICT'],
    ] as const)(
      'guarda el estado %s y el resultado %s, con la reserva afectada',
      async (status, result) => {
        const reservation = await new TypeOrmReservationRepository(
          dataSource,
        ).insert(anOtaReservation(ota.id));

        await record(
          aRevision({ status, result, reservationId: reservation.id }),
        );

        await expect(revisions.findById(REVISION_ID)).resolves.toMatchObject({
          status,
          result,
          reservationId: reservation.id,
        });
      },
    );

    it('dentro de la misma transacción, la revisión recién registrada ya está', async () => {
      const seen = await transactions.run(async (tx) => {
        await revisions.record(aRevision(), tx);
        return revisions.findById(REVISION_ID, tx);
      });

      expect(seen?.revisionId).toBe(REVISION_ID);
    });

    it('si la transacción del cambio de la reserva se revierte, la revisión no queda registrada', async () => {
      await expect(
        transactions.run(async (tx) => {
          await revisions.record(aRevision(), tx);
          throw new Error('falló el cambio de la reserva');
        }),
      ).rejects.toThrow('falló el cambio de la reserva');

      await expect(revisions.findById(REVISION_ID)).resolves.toBeNull();
    });

    it('una revisión repetida da DuplicateOtaBookingRevisionError y deja la primera como estaba', async () => {
      const otherBooking = '4d2c8e1f-7a3b-4c5d-9e6f-0a1b2c3d4e5f';
      await record(aRevision());

      await expect(
        record(aRevision({ bookingId: otherBooking })),
      ).rejects.toEqual(new DuplicateOtaBookingRevisionError(REVISION_ID));
      await expect(revisions.findById(REVISION_ID)).resolves.toMatchObject({
        bookingId: BOOKING_ID,
      });
    });

    it('dos lecturas que registran la misma revisión a la vez: solo una la guarda', async () => {
      let releaseFirst!: () => void;
      const firstHolds = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      let firstRecorded!: () => void;
      const recorded = new Promise<void>((resolve) => {
        firstRecorded = resolve;
      });

      const first = transactions.run(async (tx) => {
        await revisions.record(aRevision(), tx);
        firstRecorded();
        await firstHolds;
      });
      await recorded;
      // La segunda espera a que la primera confirme, y entonces la clave primaria la rechaza. Solo se suelta
      // la primera cuando la segunda ya está bloqueada.
      const second = record(aRevision());
      await waitForBlockedInsert();
      releaseFirst();

      await expect(first).resolves.toBeUndefined();
      await expect(second).rejects.toBeInstanceOf(
        DuplicateOtaBookingRevisionError,
      );
      const rows: unknown[] = await dataSource.query(
        'SELECT 1 FROM ota_booking_revision',
      );
      expect(rows).toHaveLength(1);
    });

    it('otro error de la base sale tal cual: una agencia que no existe', async () => {
      await expect(
        record(aRevision({ otaId: '9f1c2b3a-4d5e-4f60-8a7b-1c2d3e4f5a6b' })),
      ).rejects.toBeInstanceOf(QueryFailedError);
    });
  });

  describe('markAcked', () => {
    it('guarda la hora del ack y no cambia la del procesamiento', async () => {
      await record(aRevision());
      const before = await timesOf(REVISION_ID);

      await revisions.markAcked(REVISION_ID);

      const after = await timesOf(REVISION_ID);
      expect(after.processed_at).toBe(before.processed_at);
      expect(after.acked_at).not.toBeNull();
      // El ack va en otra sentencia, después del commit: su now() es posterior al del registro.
      expect(after.acked_at).not.toBe(after.processed_at);
      const saved = await revisions.findById(REVISION_ID);
      expect(saved?.ackedAt).toBeInstanceOf(Date);
      expect(saved?.ackedAt?.getTime()).toBeGreaterThanOrEqual(
        saved?.processedAt.getTime() ?? Infinity,
      );
    });

    it('no cambia la hora de un ack que ya estaba', async () => {
      await record(aRevision());
      await revisions.markAcked(REVISION_ID);
      const first = (await timesOf(REVISION_ID)).acked_at;

      await revisions.markAcked(REVISION_ID);

      expect((await timesOf(REVISION_ID)).acked_at).toBe(first);
    });

    it('solo cambia la revisión pedida', async () => {
      await record(aRevision());
      await record(aRevision({ revisionId: OTHER_REVISION_ID }));

      await revisions.markAcked(REVISION_ID);

      await expect(
        revisions.findById(OTHER_REVISION_ID),
      ).resolves.toMatchObject({ ackedAt: null });
    });

    it('con una revisión que no está, no hace nada', async () => {
      await expect(revisions.markAcked(REVISION_ID)).resolves.toBeUndefined();
      await expect(revisions.findById(REVISION_ID)).resolves.toBeNull();
    });
  });

  describe('findPendingAck', () => {
    it('sin revisiones, no hay ack pendientes', async () => {
      await expect(revisions.findPendingAck()).resolves.toEqual([]);
    });

    it('devuelve las que no tienen ack, de la más antigua a la más reciente', async () => {
      const third = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
      await record(aRevision({ revisionId: OTHER_REVISION_ID }));
      await record(aRevision({ revisionId: REVISION_ID }));
      await record(aRevision({ revisionId: third }));
      // La segunda ya se confirmó: no está pendiente.
      await revisions.markAcked(REVISION_ID);

      const pending = await revisions.findPendingAck();

      expect(pending.map((revision) => revision.revisionId)).toEqual([
        OTHER_REVISION_ID,
        third,
      ]);
      expect(pending.every((revision) => revision.ackedAt === null)).toBe(true);
    });

    it('con la misma hora, ordena por el id de la revisión', async () => {
      // En una sola transacción now() es la misma para las dos.
      await transactions.run(async (tx) => {
        await revisions.record(
          aRevision({ revisionId: OTHER_REVISION_ID }),
          tx,
        );
        await revisions.record(aRevision({ revisionId: REVISION_ID }), tx);
      });

      const pending = await revisions.findPendingAck();

      expect(pending.map((revision) => revision.revisionId)).toEqual([
        REVISION_ID,
        OTHER_REVISION_ID,
      ]);
    });
  });
});
