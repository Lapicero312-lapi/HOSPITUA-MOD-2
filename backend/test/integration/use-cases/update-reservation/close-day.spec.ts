import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { Clock } from '../../../../src/application/ports/out/clock.js';
import { DailyListChangeRecorderService } from '../../../../src/application/use-cases/check-view-reservation/daily-list-change-recorder.service.js';
import { OtaNoShowReporterService } from '../../../../src/application/use-cases/generate-ota-reservation/ota-no-show-reporter.service.js';
import { CloseDayService } from '../../../../src/application/use-cases/update-reservation/close-day.service.js';
import { ReservationStatusService } from '../../../../src/application/use-cases/update-reservation/reservation-status.service.js';
import type {
  Reservation,
  ReservationProps,
} from '../../../../src/domain/reservation/reservation.js';
import { TypeOrmDailyMessageRepository } from '../../../../src/infrastructure/out/persistence/repositories/daily-message.repository.js';
import { TypeOrmDailySequenceRepository } from '../../../../src/infrastructure/out/persistence/repositories/daily-sequence.repository.js';
import { TypeOrmOtaBookingRevisionRepository } from '../../../../src/infrastructure/out/persistence/repositories/ota-booking-revision.repository.js';
import { TypeOrmOtaNoShowReportRepository } from '../../../../src/infrastructure/out/persistence/repositories/ota-no-show-report.repository.js';
import { TypeOrmOtaRepository } from '../../../../src/infrastructure/out/persistence/repositories/ota.repository.js';
import { TypeOrmReservationQuery } from '../../../../src/infrastructure/out/persistence/repositories/reservation-query.repository.js';
import { TypeOrmReservationRepository } from '../../../../src/infrastructure/out/persistence/repositories/reservation.repository.js';
import { TypeOrmIdempotencyKeyRepository } from '../../../../src/infrastructure/out/persistence/repositories/idempotency-key.repository.js';
import { TypeOrmTransactionRunner } from '../../../../src/infrastructure/out/persistence/typeorm-transaction.js';
import {
  aDirectReservation,
  aDirectRoom,
  anOta,
  anOtaReservation,
  anOtaRoom,
} from '../../../support/builders.js';
import {
  openTestDataSource,
  truncateAllTables,
} from '../../support/database.js';

/**
 * El día que se cierra. El cierre corre a las 00:00:30 del día siguiente (FR-018): el reloj ya está en ese
 * día, pero el aviso a la lista y su secuencia son los del día cerrado (T023).
 */
const DAY = '2026-10-09';
const NEXT = '2026-10-10';
const CLOSING_AT = new Date('2026-10-10T05:00:30.000Z');
const CLOCK: Clock = { today: () => NEXT, now: () => CLOSING_AT };

/** El `booking_id` de Channex de la reserva de Booking (ejemplo A1 del plan de generate-ota-reservation). */
const BOOKING_ID = 'cfa33f3b-bd32-4b90-8ef9-bde2bfe986cd';

type ReservationRow = { status: string; status_reason: string | null };
type RoomRow = { stay_status: string; blocks_inventory: boolean };
type MessageRow = {
  operational_date: string;
  sequence_number: number;
  update_type: string;
  removal_reason: string | null;
  payload: Record<string, unknown>;
};

/**
 * `CloseDay` con los repositorios reales (plan de `update-reservation`, "Cierre del día", D5 y punto 13;
 * T021 y T023): lo que guarda cada transacción y lo que no deja una que falla.
 */
describe('CloseDay contra PostgreSQL real (T021 y T023)', () => {
  let dataSource: DataSource;
  let reservations: TypeOrmReservationRepository;
  let close: CloseDayService;

  /** Una reserva directa guardada que llega el día cerrado. */
  const arriving = (changes: Partial<ReservationProps> = {}) =>
    reservations.insert(
      aDirectReservation({ startDate: DAY, endDate: '2026-10-11', ...changes }),
    );

  /** Una reserva de Booking guardada que llega el día cerrado, con su revisión si `withRevision`. */
  const fromBooking = async (
    withRevision: boolean,
    changes: Partial<ReservationProps> = {},
  ): Promise<Reservation> => {
    const ota = await new TypeOrmOtaRepository(dataSource).insert(
      anOta({ name: `Booking.com ${randomUUID()}` }),
    );
    const saved = await reservations.insert(
      anOtaReservation(ota.id, {
        startDate: DAY,
        endDate: '2026-10-11',
        ...changes,
      }),
    );
    if (withRevision) {
      await new TypeOrmTransactionRunner(dataSource).run((tx) =>
        new TypeOrmOtaBookingRevisionRepository(dataSource).record(
          {
            revisionId: randomUUID(),
            otaId: ota.id,
            bookingId: BOOKING_ID,
            status: 'new',
            reservationId: saved.id,
            result: 'APPLIED',
          },
          tx,
        ),
      );
    }
    return saved;
  };

  const reservationRow = async (
    saved: Reservation,
  ): Promise<ReservationRow> => {
    const [row]: ReservationRow[] = await dataSource.query(
      'SELECT status, status_reason FROM reservation WHERE id = $1',
      [saved.id],
    );
    return row;
  };
  const roomRows = (saved: Reservation): Promise<RoomRow[]> =>
    dataSource.query(
      `SELECT stay_status, blocks_inventory FROM reservation_room
       WHERE reservation_id = $1 ORDER BY room_number NULLS LAST, id`,
      [saved.id],
    );
  const messageRows = (): Promise<MessageRow[]> =>
    dataSource.query(
      `SELECT operational_date::text, sequence_number, update_type, removal_reason, payload
       FROM daily_list_message ORDER BY operational_date, sequence_number`,
    );
  const reportRows = (): Promise<
    {
      reservation_id: string;
      booking_id: string;
      result: string;
      attempts: number;
    }[]
  > =>
    dataSource.query(
      `SELECT reservation_id::text, booking_id::text, result, attempts FROM ota_no_show_report`,
    );
  /** La lista del día cerrado ya salió a las 00:00 con la secuencia 1. */
  const listAlreadySent = () =>
    dataSource.query(
      `INSERT INTO daily_sequence (operational_date, last_sequence, list_generated)
       VALUES ($1, 1, true)`,
      [DAY],
    );

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    reservations = new TypeOrmReservationRepository(dataSource);
    close = new CloseDayService(
      new TypeOrmReservationQuery(dataSource),
      reservations,
      new ReservationStatusService(reservations),
      new DailyListChangeRecorderService(
        new TypeOrmDailySequenceRepository(dataSource),
        new TypeOrmDailyMessageRepository(dataSource),
        new TypeOrmOtaRepository(dataSource),
        CLOCK,
      ),
      new OtaNoShowReporterService(
        new TypeOrmOtaBookingRevisionRepository(dataSource),
        new TypeOrmOtaNoShowReportRepository(dataSource),
      ),
      new TypeOrmTransactionRunner(dataSource),
      // Lotes pequeños, para que se recorran varios con la base real.
      2,
      new TypeOrmIdempotencyKeyRepository(dataSource),
      CLOCK,
    );
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await truncateAllTables(dataSource);
    await dataSource.destroy();
  });

  it('No-Show: guarda NO_SHOW con DAY_CLOSE_NO_SHOW, las habitaciones NOT_ARRIVED que dejan de ocupar inventario, y ninguna Cancellation (FR-019 y FR-021)', async () => {
    const saved = await arriving({
      rooms: [aDirectRoom(), aDirectRoom({ roomNumber: '202' })],
    });

    const summary = await close.execute(DAY);

    expect(summary).toMatchObject({ noShow: 1, failed: 0 });
    expect(await reservationRow(saved)).toEqual({
      status: 'NO_SHOW',
      status_reason: 'DAY_CLOSE_NO_SHOW',
    });
    expect(await roomRows(saved)).toEqual([
      { stay_status: 'NOT_ARRIVED', blocks_inventory: false },
      { stay_status: 'NOT_ARRIVED', blocks_inventory: false },
    ]);
    const [{ total }]: { total: number }[] = await dataSource.query(
      'SELECT count(*)::int AS total FROM cancellation',
    );
    expect(total).toBe(0);
  });

  it('T023: corriendo el día siguiente, el REMOVED por NO_SHOW va con la fecha y la secuencia de la lista del día cerrado', async () => {
    await listAlreadySent();
    const saved = await arriving();

    await close.execute(DAY);

    expect(await messageRows()).toEqual([
      {
        operational_date: DAY,
        sequence_number: 2,
        update_type: 'REMOVED',
        removal_reason: 'NO_SHOW',
        payload: expect.objectContaining({
          operationalDate: DAY,
          sequenceNumber: 2,
          updateType: 'REMOVED',
          removalReason: 'NO_SHOW',
          reservationRef: saved.reservationRef,
          occurredAt: '2026-10-10T00:00:30-05:00',
        }) as Record<string, unknown>,
      },
    ]);
    const days: { operational_date: string; last_sequence: number }[] =
      await dataSource.query(
        'SELECT operational_date::text, last_sequence FROM daily_sequence ORDER BY operational_date',
      );
    // El día de hoy no se toca: su lista sale con los datos vigentes.
    expect(days).toEqual([{ operational_date: DAY, last_sequence: 2 }]);
  });

  it('una reserva de Booking deja su reporte PENDING con el booking_id de su revisión, en la transacción del NO_SHOW', async () => {
    const saved = await fromBooking(true);

    await close.execute(DAY);

    expect(await reservationRow(saved)).toMatchObject({ status: 'NO_SHOW' });
    expect(await reportRows()).toEqual([
      {
        reservation_id: saved.id,
        booking_id: BOOKING_ID,
        result: 'PENDING',
        attempts: 0,
      },
    ]);
  });

  it('una de Booking sin revisión falla sola: queda como estaba, sin aviso ni reporte, y las demás se cierran (FR-022)', async () => {
    await listAlreadySent();
    const broken = await fromBooking(false);
    const others = [await arriving(), await arriving()];

    const summary = await close.execute(DAY);

    expect(summary).toMatchObject({ noShow: 2, failed: 1 });
    expect(await reservationRow(broken)).toMatchObject({ status: 'ACTIVE' });
    expect(await roomRows(broken)).toEqual([
      { stay_status: 'EXPECTED', blocks_inventory: true },
    ]);
    expect(await reportRows()).toEqual([]);
    for (const other of others) {
      expect(await reservationRow(other)).toMatchObject({ status: 'NO_SHOW' });
    }
    // Solo los REMOVED de las dos que se cerraron.
    expect(
      (await messageRows()).map(({ payload }) => payload.reservationRef),
    ).toEqual(
      expect.arrayContaining(others.map((other) => other.reservationRef)),
    );
    expect(await messageRows()).toHaveLength(2);
  });

  it('llegada parcial: la habitación sin ingreso queda NOT_ARRIVED sin ocupar inventario y la reserva sigue IN_PROGRESS', async () => {
    const saved = await arriving({
      status: 'IN_PROGRESS',
      statusReason: 'CHECK_IN',
      rooms: [
        aDirectRoom({ stayStatus: 'CHECKED_IN' }),
        aDirectRoom({ roomNumber: '202' }),
      ],
    });

    const summary = await close.execute(DAY);

    expect(summary).toMatchObject({ notArrived: 1 });
    expect(await reservationRow(saved)).toEqual({
      status: 'IN_PROGRESS',
      status_reason: 'CHECK_IN',
    });
    expect(await roomRows(saved)).toEqual([
      { stay_status: 'CHECKED_IN', blocks_inventory: true },
      { stay_status: 'NOT_ARRIVED', blocks_inventory: false },
    ]);
  });

  it('sin ninguna habitación CHECKED_IN, la reserva queda COMPLETED con DAY_CLOSE_PARTIAL', async () => {
    const saved = await arriving({
      status: 'IN_PROGRESS',
      statusReason: 'CHECK_IN',
      rooms: [
        aDirectRoom({ stayStatus: 'CHECKED_OUT' }),
        aDirectRoom({ roomNumber: '202' }),
      ],
    });

    await close.execute(DAY);

    expect(await reservationRow(saved)).toEqual({
      status: 'COMPLETED',
      status_reason: 'DAY_CLOSE_PARTIAL',
    });
    expect(await roomRows(saved)).toEqual([
      { stay_status: 'CHECKED_OUT', blocks_inventory: false },
      { stay_status: 'NOT_ARRIVED', blocks_inventory: false },
    ]);
  });

  it('una reserva de Booking en conflicto, IN_PROGRESS, también pasa a NOT_ARRIVED su habitación sin asignar', async () => {
    const saved = await fromBooking(true, {
      status: 'IN_PROGRESS',
      statusReason: 'CHECK_IN',
      rooms: [
        anOtaRoom({ stayStatus: 'CHECKED_IN', roomNumber: '201' }),
        anOtaRoom({ roomId: null, roomNumber: null }),
      ],
      conflict: { reason: 'NO_ROOM_AVAILABLE', detectedAt: new Date() },
    });

    await close.execute(DAY);

    expect(await roomRows(saved)).toEqual([
      { stay_status: 'CHECKED_IN', blocks_inventory: true },
      { stay_status: 'NOT_ARRIVED', blocks_inventory: false },
    ]);
    expect(await reportRows()).toEqual([]);
  });

  it('recorre varios lotes con la base real: cinco reservas en lotes de dos quedan todas en NO_SHOW', async () => {
    const all: Reservation[] = [];
    for (let index = 0; index < 5; index++) {
      all.push(await arriving());
    }

    const summary = await close.execute(DAY);

    expect(summary).toMatchObject({ noShow: 5, failed: 0 });
    for (const saved of all) {
      expect(await reservationRow(saved)).toMatchObject({ status: 'NO_SHOW' });
    }
  });

  it('NFR-003: el cierre dos veces el mismo día no cambia nada ni repite avisos', async () => {
    await listAlreadySent();
    await arriving();
    await arriving({
      status: 'IN_PROGRESS',
      rooms: [
        aDirectRoom({ stayStatus: 'CHECKED_IN' }),
        aDirectRoom({ roomNumber: '202' }),
      ],
    });
    await close.execute(DAY);
    const firstMessages = await messageRows();
    const firstRows = await dataSource.query(
      'SELECT id, status, status_reason, updated_at FROM reservation ORDER BY id',
    );

    const second = await close.execute(DAY);

    expect(second).toMatchObject({ noShow: 0, notArrived: 0, failed: 0 });
    expect(await messageRows()).toEqual(firstMessages);
    expect(
      await dataSource.query(
        'SELECT id, status, status_reason, updated_at FROM reservation ORDER BY id',
      ),
    ).toEqual(firstRows);
  });
});
