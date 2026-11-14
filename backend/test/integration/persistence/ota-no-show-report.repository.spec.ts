import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Ota } from '../../../src/domain/ota/ota.js';
import type { Reservation } from '../../../src/domain/reservation/reservation.js';
import { TypeOrmOtaBookingRevisionRepository } from '../../../src/infrastructure/out/persistence/repositories/ota-booking-revision.repository.js';
import { TypeOrmOtaNoShowReportRepository } from '../../../src/infrastructure/out/persistence/repositories/ota-no-show-report.repository.js';
import { TypeOrmOtaRepository } from '../../../src/infrastructure/out/persistence/repositories/ota.repository.js';
import { TypeOrmReservationRepository } from '../../../src/infrastructure/out/persistence/repositories/reservation.repository.js';
import { TypeOrmTransactionRunner } from '../../../src/infrastructure/out/persistence/typeorm-transaction.js';
import { anOta, anOtaReservation, otaTerms } from '../../support/builders.js';
import { openTestDataSource, truncateAllTables } from '../support/database.js';

type ReportRow = {
  reservation_id: string;
  booking_id: string;
  result: string;
  attempts: number;
  /** `reported_at` en milisegundos desde 1970: la consulta directa entrega el texto de la base. */
  reported_millis: number | null;
};

const REPORTED_AT = new Date('2026-10-10T05:01:00.000Z');

/**
 * `OtaNoShowReportRepository` y `OtaBookingRevisionRepository.findBookingIdOf` contra PostgreSQL real (plan
 * de `generate-ota-reservation`, punto 8; T011b).
 */
describe('Reportes de no-show a Channex contra PostgreSQL real (T011b)', () => {
  let dataSource: DataSource;
  let reports: TypeOrmOtaNoShowReportRepository;
  let revisions: TypeOrmOtaBookingRevisionRepository;
  let transactions: TypeOrmTransactionRunner;
  let ota: Ota;

  const aBookingReservation = (): Promise<Reservation> =>
    new TypeOrmReservationRepository(dataSource).insert(
      anOtaReservation(ota.id, {
        // Cada una con su propio código de confirmación (único por agencia).
        ota: otaTerms(ota.id, {
          externalConfirmationCode: randomUUID().slice(0, 10),
        }),
      }),
    );

  const rows = (): Promise<ReportRow[]> =>
    dataSource.query(
      `SELECT reservation_id::text, booking_id::text, result, attempts,
              (extract(epoch FROM reported_at) * 1000)::float8 AS reported_millis
       FROM ota_no_show_report ORDER BY created_at, reservation_id`,
    );

  /** Deja el reporte pendiente en su transacción, como el cierre del día. */
  const pending = (reservation: Reservation, bookingId = randomUUID()) =>
    transactions.run((tx) =>
      reports.insertPending(tx, reservation.id, bookingId),
    );

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    reports = new TypeOrmOtaNoShowReportRepository(dataSource);
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

  describe('insertPending', () => {
    it('lo deja PENDING, sin intentos ni reported_at', async () => {
      const reservation = await aBookingReservation();
      const bookingId = randomUUID();

      await pending(reservation, bookingId);

      expect(await rows()).toEqual([
        {
          reservation_id: reservation.id,
          booking_id: bookingId,
          result: 'PENDING',
          attempts: 0,
          reported_millis: null,
        },
      ]);
    });

    it('si la reserva ya tiene su reporte, no hace nada (ni lo reinicia)', async () => {
      const reservation = await aBookingReservation();
      await pending(reservation);
      await reports.countAttempt(reservation.id);

      await pending(reservation);

      expect(await rows()).toMatchObject([{ result: 'PENDING', attempts: 1 }]);
    });

    it('va en la transacción de quien llama: si se revierte, no queda', async () => {
      const reservation = await aBookingReservation();

      await expect(
        transactions.run(async (tx) => {
          await reports.insertPending(tx, reservation.id, randomUUID());
          throw new Error('el NO_SHOW falló después');
        }),
      ).rejects.toThrow('el NO_SHOW falló después');

      expect(await rows()).toEqual([]);
    });
  });

  it('findPending trae solo los PENDING, del más antiguo al más reciente', async () => {
    const [first, second, third] = [
      await aBookingReservation(),
      await aBookingReservation(),
      await aBookingReservation(),
    ];
    for (const reservation of [first, second, third]) {
      await pending(reservation);
    }
    await reports.markReported(second.id, REPORTED_AT);

    const found = await reports.findPending();

    expect(found.map(({ reservationId }) => reservationId)).toEqual([
      first.id,
      third.id,
    ]);
    expect(found[0]).toMatchObject({ attempts: 0 });
    expect(found[0].createdAt).toBeInstanceOf(Date);
  });

  it('markReported: REPORTED, un intento más y reported_at', async () => {
    const reservation = await aBookingReservation();
    await pending(reservation);

    await reports.markReported(reservation.id, REPORTED_AT);

    expect(await rows()).toMatchObject([
      {
        result: 'REPORTED',
        attempts: 1,
        reported_millis: REPORTED_AT.getTime(),
      },
    ]);
  });

  it('markRejected: REJECTED, un intento más y sin reported_at', async () => {
    const reservation = await aBookingReservation();
    await pending(reservation);

    await reports.markRejected(reservation.id);

    expect(await rows()).toMatchObject([
      { result: 'REJECTED', attempts: 1, reported_millis: null },
    ]);
  });

  it('countAttempt: sigue PENDING con un intento más', async () => {
    const reservation = await aBookingReservation();
    await pending(reservation);

    await reports.countAttempt(reservation.id);
    await reports.countAttempt(reservation.id);

    expect(await rows()).toMatchObject([{ result: 'PENDING', attempts: 2 }]);
  });

  it('un reporte que ya terminó no cambia: ni otro resultado ni otro intento', async () => {
    const reservation = await aBookingReservation();
    await pending(reservation);
    await reports.markReported(reservation.id, REPORTED_AT);

    await reports.markRejected(reservation.id);
    await reports.countAttempt(reservation.id);
    await reports.markReported(reservation.id, new Date());

    expect(await rows()).toMatchObject([
      {
        result: 'REPORTED',
        attempts: 1,
        reported_millis: REPORTED_AT.getTime(),
      },
    ]);
  });

  describe('OtaBookingRevisionRepository.findBookingIdOf', () => {
    const revisionOf = (
      reservationId: string | null,
      bookingId: string,
      status: 'new' | 'modified' = 'new',
    ) =>
      transactions.run((tx) =>
        revisions.record(
          {
            revisionId: randomUUID(),
            otaId: ota.id,
            bookingId,
            status,
            reservationId,
            result: 'APPLIED',
          },
          tx,
        ),
      );

    it('devuelve el booking_id de las revisiones de la reserva, también dentro de una transacción', async () => {
      const reservation = await aBookingReservation();
      const bookingId = randomUUID();
      await revisionOf(reservation.id, bookingId);
      await revisionOf(reservation.id, bookingId, 'modified');

      expect(await revisions.findBookingIdOf(reservation.id)).toBe(bookingId);
      expect(
        await transactions.run((tx) =>
          revisions.findBookingIdOf(reservation.id, tx),
        ),
      ).toBe(bookingId);
    });

    it('sin revisiones de esa reserva, null (aunque otras reservas tengan)', async () => {
      const reservation = await aBookingReservation();
      const other = await aBookingReservation();
      await revisionOf(other.id, randomUUID());
      await revisionOf(null, randomUUID());

      expect(await revisions.findBookingIdOf(reservation.id)).toBeNull();
    });
  });
});
