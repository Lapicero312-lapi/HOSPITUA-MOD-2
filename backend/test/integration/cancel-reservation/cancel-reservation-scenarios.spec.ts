import type { Response } from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Reservation } from '../../../src/domain/reservation/reservation.js';
import type {
  CancellationChannel,
  ReservationStatus,
} from '../../../src/domain/shared/enums.js';
import { aDirectRoom } from '../../support/builders.js';
import {
  CancellationApp,
  CHECK_OUT_DATE,
  NOW,
  REASON,
  RECEPTIONIST,
  TODAY,
} from '../support/cancel-reservation.js';

/** La referencia y el `updatedAt` del ejemplo de A: la versión de la reserva que leyó la pantalla. */
const EXAMPLE_REF = 'RSV-3F9A1C7B';
const EXAMPLE_UPDATED_AT = '2026-10-08T15:42:10.123456-05:00';

/** La hora de la cancelación en el ejemplo de A, en hora de Colombia. */
const CANCELLED_AT = '2026-10-09T10:15:20-05:00';

/** Una llegada "dentro de varios días" (escenario 3). */
const FUTURE_START = '2026-10-20';
const FUTURE_END = '2026-10-22';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * T011 de `cancel-reservation`: los escenarios 1 a 6 de la historia 1 del spec, con lo que pide cada fila de
 * "Pruebas por escenario" del plan. Todo es real: la aplicación completa, PostgreSQL y la lista del día que
 * genera `GenerateDailyList`. La Recepcionista cancela por la ruta A y Booking por el puerto
 * `CancelReservation`, como lo llamará `generate-ota-reservation` (contrato B). Las reglas, una por una, las
 * prueban las pruebas de `CancelReservation` (T005 a T010).
 */
describe('cancel-reservation: escenarios 1 a 6 de la historia 1 (T011)', () => {
  let world: CancellationApp;

  /** El `400` del contrato C para la cancelación de esa referencia. */
  function expectRejected(
    res: Response,
    reservationRef: string,
    errorCode: string,
    message: string,
  ): void {
    expect(res.body).toEqual({
      errorCode,
      message,
      timestamp: expect.any(String) as string,
      path: `/api/reservations/${reservationRef}/cancellation`,
    });
  }

  /** Nada cambió: ni la reserva, ni la `Cancellation`, ni los avisos al Módulo 1, ni la disponibilidad. */
  async function expectUntouched(before: Reservation): Promise<void> {
    const after = await world.stored(before.reservationRef);
    expect(after.status).toBe(before.status);
    expect(after.updatedAt).toBe(before.updatedAt);
    expect(await world.cancellations()).toEqual([]);
    expect(await world.listUpdates()).toEqual([]);
    expect(await world.availabilityMarks()).toEqual([]);
  }

  /** Cancela la reserva por el canal indicado: la Recepcionista con el cuerpo de A, Booking con B. */
  async function cancelThrough(
    channel: CancellationChannel,
    reservation: Reservation,
  ): Promise<void> {
    if (channel === 'RECEPTION') {
      await world
        .byReception(reservation.reservationRef, world.bodyFor(reservation))
        .expect(200);
      return;
    }
    await world.byBooking(reservation.reservationRef);
  }

  beforeAll(async () => {
    world = await CancellationApp.start();
  });

  beforeEach(async () => {
    await world.reset();
  });

  afterAll(async () => {
    await world?.close();
  });

  it('escenario 1: la Recepcionista cancela una ACTIVE que llega hoy y está en la lista; CANCELLED, su Cancellation con canal RECEPTION y el REMOVED con motivo CANCELLED', async () => {
    const stored = await world.storeDirect({ reservationRef: EXAMPLE_REF });
    await world.dataSource.query(
      'UPDATE reservation SET updated_at = $2 WHERE id = $1',
      [stored.id, EXAMPLE_UPDATED_AT],
    );
    await world.sendDailyList();
    expect(await world.listedReservations()).toEqual([EXAMPLE_REF]);

    // La solicitud del ejemplo de A, tal cual.
    const res = await world
      .byReception(EXAMPLE_REF, {
        updatedAt: EXAMPLE_UPDATED_AT,
        acknowledged: true,
        reason: REASON,
      })
      .expect(200);

    const cancellations = await world.cancellations();
    expect(cancellations).toEqual([
      {
        reservation_ref: EXAMPLE_REF,
        cancellation_id: expect.stringMatching(UUID) as string,
        cancellation_millis: NOW.getTime(),
        reason: REASON,
        channel: 'RECEPTION',
        processed_by: RECEPTIONIST,
        status: 'COMPLETED',
      },
    ]);
    // La respuesta del ejemplo de A, con la Cancellation que quedó guardada.
    expect(res.body).toEqual({
      reservationRef: EXAMPLE_REF,
      status: 'CANCELLED',
      cancellation: {
        cancellationId: cancellations[0].cancellation_id,
        cancellationDate: CANCELLED_AT,
        channel: 'RECEPTION',
        reason: REASON,
        processedBy: RECEPTIONIST,
        status: 'COMPLETED',
      },
    });
    const after = await world.stored(EXAMPLE_REF);
    expect(after.status).toBe('CANCELLED');
    expect(after.statusReason).toBe('CANCELLED_BY_RECEPTION');
    expect(await world.blocksInventory(after)).toEqual([false]);
    // El aviso al Módulo 1: la actualización REMOVED del plan de check-view-reservation, en espera de salir.
    expect(await world.listUpdates()).toEqual([
      {
        sequence_number: 2,
        update_type: 'REMOVED',
        removal_reason: 'CANCELLED',
        reservation_ref: EXAMPLE_REF,
        publish_status: 'PENDING',
        payload: {
          messageId: expect.stringMatching(UUID) as string,
          sequenceNumber: 2,
          operationalDate: TODAY,
          updateType: 'REMOVED',
          occurredAt: CANCELLED_AT,
          reservationRef: EXAMPLE_REF,
          removalReason: 'CANCELLED',
        },
      },
    ]);
    // Paso 7 del flujo: la categoría y las fechas liberadas, para el envío a Channex.
    expect(await world.availabilityMarks()).toEqual([
      { category_room: 'DOBLE', date_from: TODAY, date_to: CHECK_OUT_DATE },
    ]);
  });

  describe('escenario 2: Booking cancela una suya que llega hoy', () => {
    it('ACTIVE y en la lista: CANCELLED, su Cancellation con canal OTA_API y processedBy Booking.com, y el REMOVED', async () => {
      const stored = await world.storeBooking();
      await world.sendDailyList();
      expect(await world.listedReservations()).toEqual([stored.reservationRef]);

      const cancelled = await world.byBooking(stored.reservationRef);

      expect(cancelled.status).toBe('CANCELLED');
      expect(cancelled.statusReason).toBe('CANCELLED_BY_OTA');
      const after = await world.stored(stored.reservationRef);
      expect(after.status).toBe('CANCELLED');
      expect(await world.blocksInventory(after)).toEqual([false]);
      expect(await world.cancellations()).toEqual([
        {
          reservation_ref: stored.reservationRef,
          cancellation_id: expect.stringMatching(UUID) as string,
          cancellation_millis: NOW.getTime(),
          reason: null,
          channel: 'OTA_API',
          processed_by: 'Booking.com',
          status: 'COMPLETED',
        },
      ]);
      expect(await world.listUpdates()).toMatchObject([
        {
          sequence_number: 2,
          update_type: 'REMOVED',
          removal_reason: 'CANCELLED',
          reservation_ref: stored.reservationRef,
          publish_status: 'PENDING',
        },
      ]);
      expect(await world.availabilityMarks()).toEqual([
        { category_room: 'DOBLE', date_from: TODAY, date_to: CHECK_OUT_DATE },
      ]);
    });

    it('repetir la cancelación no cambia nada: una sola Cancellation, un solo REMOVED y una sola marca', async () => {
      const stored = await world.storeBooking();
      await world.sendDailyList();
      const first = await world.byBooking(stored.reservationRef);

      const repeated = await world.byBooking(stored.reservationRef);

      expect(repeated.status).toBe('CANCELLED');
      expect(repeated.updatedAt).toBe(first.updatedAt);
      expect(await world.cancellations()).toHaveLength(1);
      expect(await world.listUpdates()).toHaveLength(1);
      expect(await world.availabilityMarks()).toHaveLength(1);
    });

    it('PENDING: se cancela con su Cancellation, sin aviso, porque no viaja en la lista (regla 6)', async () => {
      const stored = await world.storeBooking({ status: 'PENDING' });
      await world.sendDailyList();
      expect(await world.listedReservations()).toEqual([]);

      const cancelled = await world.byBooking(stored.reservationRef);

      expect(cancelled.status).toBe('CANCELLED');
      expect(await world.cancellations()).toMatchObject([
        {
          reservation_ref: stored.reservationRef,
          channel: 'OTA_API',
          processed_by: 'Booking.com',
        },
      ]);
      expect(await world.listUpdates()).toEqual([]);
    });
  });

  it.each([
    ['la Recepcionista', 'RECEPTION', 'ACTIVE'],
    ['la Recepcionista', 'RECEPTION', 'PENDING'],
    ['Booking', 'OTA_API', 'ACTIVE'],
    ['Booking', 'OTA_API', 'PENDING'],
  ] as const)(
    'escenario 3: %s cancela una %s con llegada futura; CANCELLED y su Cancellation, sin ningún aviso al Módulo 1',
    async (_who, channel: CancellationChannel, status: ReservationStatus) => {
      const changes = { status, startDate: FUTURE_START, endDate: FUTURE_END };
      const stored =
        channel === 'RECEPTION'
          ? await world.storeDirect(changes)
          : await world.storeBooking(changes);
      // La lista de hoy ya salió: un cambio que la tocara dejaría su aviso.
      await world.sendDailyList();

      await cancelThrough(channel, stored);

      expect((await world.stored(stored.reservationRef)).status).toBe(
        'CANCELLED',
      );
      expect(await world.cancellations()).toMatchObject([
        { reservation_ref: stored.reservationRef, channel },
      ]);
      expect(await world.listUpdates()).toEqual([]);
    },
  );

  describe('escenario 4: estadía en curso o finalizada', () => {
    const NOT_CANCELLABLE = [
      'IN_PROGRESS',
      'COMPLETED',
      'CANCELLED',
      'NO_SHOW',
    ] as const;

    it.each(NOT_CANCELLABLE)(
      'la Recepcionista sobre una %s recibe 400 STATUS_NOT_CANCELLABLE y no se avisa nada',
      async (status) => {
        const stored = await world.storeDirect({ status });
        await world.sendDailyList();

        const res = await world
          .byReception(stored.reservationRef, world.bodyFor(stored))
          .expect(400);

        expectRejected(
          res,
          stored.reservationRef,
          'STATUS_NOT_CANCELLABLE',
          'El estado actual de la reserva no admite cancelación.',
        );
        await expectUntouched(stored);
      },
    );

    it.each(NOT_CANCELLABLE)(
      'Booking sobre una %s recibe la reserva con su estado, sin tocarla, para que generate-ota-reservation la ignore o marque el conflicto',
      async (status) => {
        const stored = await world.storeBooking({ status });
        await world.sendDailyList();

        const result = await world.byBooking(stored.reservationRef);

        expect(result.status).toBe(status);
        await expectUntouched(stored);
      },
    );
  });

  it('escenario 5: la Recepcionista cancela una que llega hoy con las habitaciones 101 y 102; una sola Cancellation y un solo REMOVED', async () => {
    const stored = await world.storeDirect({
      rooms: [
        aDirectRoom({ roomNumber: '101' }),
        aDirectRoom({ roomNumber: '102' }),
      ],
    });
    await world.sendDailyList();
    expect(await world.listedReservations()).toEqual([stored.reservationRef]);

    await world
      .byReception(stored.reservationRef, world.bodyFor(stored))
      .expect(200);

    const after = await world.stored(stored.reservationRef);
    expect(after.status).toBe('CANCELLED');
    expect(await world.blocksInventory(after)).toEqual([false, false]);
    expect(await world.cancellations()).toMatchObject([
      { reservation_ref: stored.reservationRef, channel: 'RECEPTION' },
    ]);
    expect(await world.listUpdates()).toMatchObject([
      {
        update_type: 'REMOVED',
        removal_reason: 'CANCELLED',
        reservation_ref: stored.reservationRef,
      },
    ]);
  });

  it.each(['ACTIVE', 'PENDING'] as const)(
    'escenario 6: la Recepcionista sobre una de Booking en %s recibe 400 OTA_RESERVATION_CANCEL_VIA_API y no se registra ninguna Cancellation',
    async (status) => {
      const stored = await world.storeBooking({ status });
      await world.sendDailyList();

      const res = await world
        .byReception(stored.reservationRef, world.bodyFor(stored))
        .expect(400);

      expectRejected(
        res,
        stored.reservationRef,
        'OTA_RESERVATION_CANCEL_VIA_API',
        'La cancelación de una reserva de OTA debe llegar desde Booking.',
      );
      await expectUntouched(stored);
    },
  );
});
