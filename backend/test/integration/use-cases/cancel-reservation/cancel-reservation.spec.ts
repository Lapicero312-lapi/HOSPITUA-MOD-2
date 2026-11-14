import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Clock } from '../../../../src/application/ports/out/clock.js';
import type { Transaction } from '../../../../src/application/ports/out/transaction.js';
import { CancelReservationService } from '../../../../src/application/use-cases/cancel-reservation/cancel-reservation.service.js';
import type { CancelReservationCommand } from '../../../../src/application/use-cases/cancel-reservation/ports/in/cancel-reservation.port.js';
import { AriChangeRecorderService } from '../../../../src/application/use-cases/configure-ota/ari-change-recorder.service.js';
import type { AriChangeRecorder } from '../../../../src/application/use-cases/configure-ota/ports/in/ari-change-recorder.port.js';
import { DailyListChangeRecorderService } from '../../../../src/application/use-cases/check-view-reservation/daily-list-change-recorder.service.js';
import { colombiaTimeWithMicroseconds } from '../../../../src/application/use-cases/check-view-reservation/message-time.js';
import type { DailyListChangeRecorder } from '../../../../src/application/use-cases/check-view-reservation/ports/in/daily-list-change-recorder.port.js';
import { ReservationLookupService } from '../../../../src/application/use-cases/check-view-reservation/reservation-lookup.service.js';
import { ReservationStatusService } from '../../../../src/application/use-cases/update-reservation/reservation-status.service.js';
import type { Reservation } from '../../../../src/domain/reservation/reservation.js';
import { BusinessError } from '../../../../src/domain/shared/business-error.js';
import { TypeOrmAriPendingChangeRepository } from '../../../../src/infrastructure/out/persistence/repositories/ari-pending-change.repository.js';
import { TypeOrmCancellationRepository } from '../../../../src/infrastructure/out/persistence/repositories/cancellation.repository.js';
import { TypeOrmDailyMessageRepository } from '../../../../src/infrastructure/out/persistence/repositories/daily-message.repository.js';
import { TypeOrmDailySequenceRepository } from '../../../../src/infrastructure/out/persistence/repositories/daily-sequence.repository.js';
import { TypeOrmOtaRepository } from '../../../../src/infrastructure/out/persistence/repositories/ota.repository.js';
import { TypeOrmReservationQuery } from '../../../../src/infrastructure/out/persistence/repositories/reservation-query.repository.js';
import { TypeOrmReservationRepository } from '../../../../src/infrastructure/out/persistence/repositories/reservation.repository.js';
import { TypeOrmTransactionRunner } from '../../../../src/infrastructure/out/persistence/typeorm-transaction.js';
import {
  aDirectReservation,
  aDirectRoom,
  anOta,
  anOtaReservation,
} from '../../../support/builders.js';
import {
  openTestDataSource,
  truncateAllTables,
} from '../../support/database.js';
import { NO_PUBLICATION } from '../../../support/publication.js';

/** El día operativo y la hora del ejemplo de A: 2026-10-09 a las 10:15:20 de Colombia. */
const TODAY = '2026-10-09';
const NOW = new Date('2026-10-09T15:15:20.000Z');
const CLOCK: Clock = { today: () => TODAY, now: () => NOW };

type CancellationRow = {
  reservation_id: string;
  /** `cancellation_date` en milisegundos desde 1970: la consulta directa entrega el texto de la base. */
  cancellation_millis: number;
  reason: string | null;
  channel: string;
  processed_by: string;
  status: string;
};

type MessageRow = {
  sequence_number: number;
  update_type: string;
  removal_reason: string | null;
  reservation_id: string;
  publish_status: string;
};

/**
 * `CancelReservation` con los repositorios reales (plan de `cancel-reservation`, reglas 3 a 6 y D2): el
 * cambio de estado, la liberación del inventario, la `Cancellation` y el aviso a la lista del día van en
 * una sola transacción.
 */
describe('CancelReservation contra PostgreSQL real (T005 a T007)', () => {
  let dataSource: DataSource;
  let reservations: TypeOrmReservationRepository;
  let transactions: TypeOrmTransactionRunner;
  let dailyList: DailyListChangeRecorderService;
  let availability: AriChangeRecorderService;

  /** El servicio; `recorder` y `ari` permiten cambiar la lista del día y la disponibilidad por unas que fallan. */
  const serviceWith = (
    recorder: DailyListChangeRecorder = dailyList,
    ari: AriChangeRecorder = availability,
  ) =>
    new CancelReservationService(
      new ReservationLookupService(
        new TypeOrmReservationQuery(dataSource),
        reservations,
      ),
      new ReservationStatusService(reservations),
      new TypeOrmCancellationRepository(dataSource),
      recorder,
      CLOCK,
      transactions,
      ari,
    );

  const cancel = (
    command: CancelReservationCommand,
    recorder?: DailyListChangeRecorder,
    ari?: AriChangeRecorder,
  ) =>
    transactions.run((tx: Transaction) =>
      serviceWith(recorder, ari).cancel(tx, command),
    );

  /** La cancelación de Booking del contrato B. */
  const fromBooking = (saved: Reservation): CancelReservationCommand => ({
    reservationRef: saved.reservationRef,
    channel: 'OTA_API',
    processedBy: 'Booking.com',
    reason: null,
  });

  /** Una reserva de Booking guardada, en su agencia. */
  const aStoredBookingReservation = async (changes = {}) => {
    const ota = await new TypeOrmOtaRepository(dataSource).insert(anOta());
    return reservations.insert(
      anOtaReservation(ota.id, {
        startDate: TODAY,
        endDate: '2026-10-12',
        ...changes,
      }),
    );
  };

  const availabilityRows = (): Promise<
    { category_room: string; date_from: string; date_to: string }[]
  > =>
    dataSource.query(
      `SELECT category_room, date_from::text, date_to::text
       FROM ari_pending_change ORDER BY category_room`,
    );

  /** La cancelación de la Recepcionista, con el `updatedAt` como lo envía la pantalla. */
  const fromReception = (
    saved: Reservation,
    changes: Partial<CancelReservationCommand> = {},
  ): CancelReservationCommand => ({
    reservationRef: saved.reservationRef,
    channel: 'RECEPTION',
    processedBy: 'laura.mendez',
    reason: 'El huésped cambió de planes',
    acknowledged: true,
    expectedUpdatedAt: colombiaTimeWithMicroseconds(saved.updatedAt as string),
    ...changes,
  });

  /** La lista del día ya salió con la secuencia 1: los cambios de hoy se avisan desde la 2. */
  const listAlreadySent = () =>
    dataSource.query(
      `INSERT INTO daily_sequence (operational_date, last_sequence, list_generated)
       VALUES ($1, 1, true)`,
      [TODAY],
    );

  const arrivingToday = (changes = {}) =>
    aDirectReservation({ startDate: TODAY, endDate: '2026-10-12', ...changes });

  const cancellationRows = (): Promise<CancellationRow[]> =>
    dataSource.query(
      `SELECT reservation_id::text,
              (extract(epoch FROM cancellation_date) * 1000)::float8 AS cancellation_millis, reason, channel, processed_by, status
       FROM cancellation`,
    );

  const messageRows = (): Promise<MessageRow[]> =>
    dataSource.query(
      `SELECT sequence_number, update_type, removal_reason, reservation_id::text, publish_status
       FROM daily_list_message ORDER BY sequence_number`,
    );

  const blocksInventory = async (reservationId: string): Promise<boolean[]> => {
    const rows: { blocks_inventory: boolean }[] = await dataSource.query(
      'SELECT blocks_inventory FROM reservation_room WHERE reservation_id = $1 ORDER BY room_number',
      [reservationId],
    );
    return rows.map((row) => row.blocks_inventory);
  };

  const businessErrorOf = (promise: Promise<unknown>) =>
    promise.then(
      () => {
        throw new Error('La cancelación debía fallar.');
      },
      (error: unknown) => {
        expect(error).toBeInstanceOf(BusinessError);
        return (error as BusinessError).errorCode;
      },
    );

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    reservations = new TypeOrmReservationRepository(dataSource);
    transactions = new TypeOrmTransactionRunner(dataSource);
    dailyList = new DailyListChangeRecorderService(
      new TypeOrmDailySequenceRepository(dataSource),
      new TypeOrmDailyMessageRepository(dataSource),
      new TypeOrmOtaRepository(dataSource),
      CLOCK,
      transactions,
      NO_PUBLICATION,
    );
    availability = new AriChangeRecorderService(
      new TypeOrmAriPendingChangeRepository(dataSource),
    );
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('escenario 1: la Recepcionista cancela una directa que llega hoy; CANCELLED, inventario libre, su Cancellation y el REMOVED con motivo CANCELLED', async () => {
    await listAlreadySent();
    const saved = await reservations.insert(arrivingToday());

    const cancelled = await cancel(fromReception(saved));

    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.statusReason).toBe('CANCELLED_BY_RECEPTION');
    expect(cancelled.updatedAt).not.toBe(saved.updatedAt);
    const stored = await reservations.findByRef(saved.reservationRef);
    expect(stored?.status).toBe('CANCELLED');
    expect(await blocksInventory(saved.id)).toEqual([false]);
    expect(await cancellationRows()).toEqual([
      {
        reservation_id: saved.id,
        cancellation_millis: NOW.getTime(),
        reason: 'El huésped cambió de planes',
        channel: 'RECEPTION',
        processed_by: 'laura.mendez',
        status: 'COMPLETED',
      },
    ]);
    expect(await messageRows()).toEqual([
      {
        sequence_number: 2,
        update_type: 'REMOVED',
        removal_reason: 'CANCELLED',
        reservation_id: saved.id,
        publish_status: 'PENDING',
      },
    ]);
  });

  it('escenario 2: Booking cancela la suya que llega hoy; canal OTA_API, processedBy Booking.com y REMOVED', async () => {
    await listAlreadySent();
    const ota = await new TypeOrmOtaRepository(dataSource).insert(anOta());
    const saved = await reservations.insert(
      anOtaReservation(ota.id, { startDate: TODAY, endDate: '2026-10-12' }),
    );

    const cancelled = await cancel({
      reservationRef: saved.reservationRef,
      channel: 'OTA_API',
      processedBy: 'Booking.com',
      reason: null,
    });

    expect(cancelled.statusReason).toBe('CANCELLED_BY_OTA');
    expect(await cancellationRows()).toMatchObject([
      { channel: 'OTA_API', processed_by: 'Booking.com', reason: null },
    ]);
    expect(await messageRows()).toMatchObject([
      { update_type: 'REMOVED', removal_reason: 'CANCELLED' },
    ]);
  });

  it('escenario 3: con llegada futura se cancela y queda su Cancellation, sin ningún aviso al Módulo 1', async () => {
    await listAlreadySent();
    const saved = await reservations.insert(
      aDirectReservation({ startDate: '2026-10-20', endDate: '2026-10-22' }),
    );

    await cancel(fromReception(saved));

    expect((await reservations.findByRef(saved.reservationRef))?.status).toBe(
      'CANCELLED',
    );
    expect(await cancellationRows()).toHaveLength(1);
    expect(await messageRows()).toEqual([]);
  });

  it('escenario 5: con varias habitaciones, una sola Cancellation y un solo REMOVED, y todas dejan de ocupar inventario', async () => {
    await listAlreadySent();
    const saved = await reservations.insert(
      arrivingToday({
        rooms: [aDirectRoom(), aDirectRoom({ roomNumber: '202' })],
      }),
    );

    await cancel(fromReception(saved));

    expect(await blocksInventory(saved.id)).toEqual([false, false]);
    expect(await cancellationRows()).toHaveLength(1);
    expect(await messageRows()).toHaveLength(1);
  });

  it('la cancelada libera sus habitaciones: otra reserva puede ocuparlas en las mismas fechas (D3)', async () => {
    const saved = await reservations.insert(arrivingToday());
    await cancel(fromReception(saved));

    const sameRoom = arrivingToday({
      rooms: [aDirectRoom({ roomId: saved.rooms[0].roomId })],
    });

    await expect(reservations.insert(sameRoom)).resolves.toBeDefined();
  });

  it('escenario 6: la Recepcionista sobre una de OTA no cambia nada ni registra la Cancellation', async () => {
    await listAlreadySent();
    const ota = await new TypeOrmOtaRepository(dataSource).insert(anOta());
    const saved = await reservations.insert(
      anOtaReservation(ota.id, { startDate: TODAY, endDate: '2026-10-12' }),
    );

    await expect(businessErrorOf(cancel(fromReception(saved)))).resolves.toBe(
      'OTA_RESERVATION_CANCEL_VIA_API',
    );
    const stored = await reservations.findByRef(saved.reservationRef);
    expect(stored?.status).toBe('ACTIVE');
    expect(stored?.updatedAt).toBe(saved.updatedAt);
    expect(await cancellationRows()).toEqual([]);
    expect(await messageRows()).toEqual([]);
  });

  it('regla 4: si falla el aviso a la lista del día, se revierte todo: ni el estado, ni el inventario, ni la Cancellation', async () => {
    await listAlreadySent();
    const saved = await reservations.insert(arrivingToday());
    const failing: DailyListChangeRecorder = {
      record: () => Promise.reject(new Error('se cayó la conexión')),
    };

    await expect(cancel(fromReception(saved), failing)).rejects.toThrow(
      'se cayó la conexión',
    );

    const stored = await reservations.findByRef(saved.reservationRef);
    expect(stored?.status).toBe('ACTIVE');
    expect(await blocksInventory(saved.id)).toEqual([true]);
    expect(await cancellationRows()).toEqual([]);
    expect(await messageRows()).toEqual([]);
    expect(await availabilityRows()).toEqual([]);
  });

  describe('la disponibilidad liberada para Channex (T009, regla 10)', () => {
    it('la Recepcionista: una marca por categoría con las noches de la reserva', async () => {
      const saved = await reservations.insert(
        arrivingToday({
          rooms: [
            aDirectRoom({ roomNumber: '201' }),
            aDirectRoom({ roomNumber: '202' }),
            aDirectRoom({ roomNumber: '101', categoryRoom: 'SUITE' }),
          ],
        }),
      );

      await cancel(fromReception(saved));

      expect(await availabilityRows()).toEqual([
        {
          category_room: 'DOBLE',
          date_from: TODAY,
          date_to: '2026-10-12',
        },
        {
          category_room: 'SUITE',
          date_from: TODAY,
          date_to: '2026-10-12',
        },
      ]);
    });

    it('Booking: también deja su marca', async () => {
      const saved = await aStoredBookingReservation();

      await cancel(fromBooking(saved));

      expect(await availabilityRows()).toEqual([
        {
          category_room: 'DOBLE',
          date_from: TODAY,
          date_to: '2026-10-12',
        },
      ]);
    });

    it('regla 4, canal B: si quien llama falla después, en su misma transacción, no queda nada: tampoco la marca', async () => {
      await listAlreadySent();
      const saved = await aStoredBookingReservation();

      await expect(
        transactions.run(async (tx: Transaction) => {
          await serviceWith().cancel(tx, fromBooking(saved));
          throw new Error('falló generate-ota-reservation');
        }),
      ).rejects.toThrow('falló generate-ota-reservation');

      const stored = await reservations.findByRef(saved.reservationRef);
      expect(stored?.status).toBe('ACTIVE');
      expect(await cancellationRows()).toEqual([]);
      expect(await messageRows()).toEqual([]);
      expect(await availabilityRows()).toEqual([]);
    });

    it('regla 4: si no se puede anotar, se revierte todo, también el aviso a la lista del día', async () => {
      await listAlreadySent();
      const saved = await reservations.insert(arrivingToday());
      const failing: AriChangeRecorder = {
        record: () => Promise.reject(new Error('se cayó la conexión')),
      };

      await expect(
        cancel(fromReception(saved), undefined, failing),
      ).rejects.toThrow('se cayó la conexión');

      const stored = await reservations.findByRef(saved.reservationRef);
      expect(stored?.status).toBe('ACTIVE');
      expect(await blocksInventory(saved.id)).toEqual([true]);
      expect(await cancellationRows()).toEqual([]);
      expect(await messageRows()).toEqual([]);
      expect(await availabilityRows()).toEqual([]);
    });
  });

  describe('lo que Booking ya no puede cancelar no es un error (T009, contrato B)', () => {
    it('repetir la revisión no cambia nada: una sola Cancellation, un solo REMOVED y una sola marca', async () => {
      await listAlreadySent();
      const saved = await aStoredBookingReservation();
      const first = await cancel(fromBooking(saved));

      const repeated = await cancel(fromBooking(saved));

      expect(repeated.status).toBe('CANCELLED');
      expect(repeated.updatedAt).toBe(first.updatedAt);
      expect(await cancellationRows()).toHaveLength(1);
      expect(await messageRows()).toHaveLength(1);
      expect(await availabilityRows()).toHaveLength(1);
    });

    it.each(['IN_PROGRESS', 'COMPLETED', 'NO_SHOW'] as const)(
      'escenario 4: en %s devuelve su estado sin tocar nada, para que generate-ota-reservation marque el conflicto',
      async (status) => {
        const saved = await aStoredBookingReservation({ status });

        const result = await cancel(fromBooking(saved));

        expect(result.status).toBe(status);
        const stored = await reservations.findByRef(saved.reservationRef);
        expect(stored?.status).toBe(status);
        expect(stored?.updatedAt).toBe(saved.updatedAt);
        expect(await cancellationRows()).toEqual([]);
        expect(await messageRows()).toEqual([]);
        expect(await availabilityRows()).toEqual([]);
      },
    );
  });

  it('D2: dos cancelaciones simultáneas con el mismo updatedAt; una aplica y la otra recibe CONCURRENT_UPDATE, con una sola Cancellation y un solo aviso', async () => {
    await listAlreadySent();
    const saved = await reservations.insert(arrivingToday());

    const results = await Promise.allSettled([
      cancel(fromReception(saved)),
      cancel(fromReception(saved, { processedBy: 'carlos.rios' })),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(BusinessError);
    expect(rejected[0].reason).toMatchObject({
      errorCode: 'CONCURRENT_UPDATE',
      message: 'Esta reserva ya fue actualizada o cancelada recientemente',
    });
    expect(await cancellationRows()).toHaveLength(1);
    expect(await messageRows()).toHaveLength(1);
  });

  it('paso 4: el updatedAt que la pantalla leyó antes de otro cambio da CONCURRENT_UPDATE y no cancela', async () => {
    const saved = await reservations.insert(arrivingToday());
    // Otro cambio de la reserva después de que la pantalla la leyó: la base renueva su updatedAt.
    await transactions.run((tx) => reservations.update(saved, tx));

    await expect(businessErrorOf(cancel(fromReception(saved)))).resolves.toBe(
      'CONCURRENT_UPDATE',
    );
    expect(await cancellationRows()).toEqual([]);
  });
});
