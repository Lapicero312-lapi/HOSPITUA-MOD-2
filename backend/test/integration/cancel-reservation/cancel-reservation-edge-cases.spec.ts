import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
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
import {
  RESERVATION_LOOKUP,
  type ReservationLookup,
} from '../../../src/application/use-cases/check-view-reservation/ports/in/reservation-lookup.port.js';
import type { Reservation } from '../../../src/domain/reservation/reservation.js';
import { aDirectRoom } from '../../support/builders.js';
import { CancellationApp, REASON } from '../support/cancel-reservation.js';

/** El `updatedAt` del ejemplo de A. */
const EXAMPLE_UPDATED_AT = '2026-10-08T15:42:10.123456-05:00';

/**
 * T012 de `cancel-reservation`: los casos borde de la historia 1 del spec, con lo que pide cada fila de
 * "Pruebas por escenario" del plan: la referencia vacía o nula, el fallo de la publicación del aviso, dos
 * cancelaciones simultáneas y la reserva con varias habitaciones cuando una ya tuvo Check-In. Todo es real:
 * la aplicación completa, PostgreSQL y la lista del día que genera `GenerateDailyList`.
 */
describe('cancel-reservation: casos borde de la historia 1 (T012)', () => {
  let world: CancellationApp;

  /** La búsqueda con bloqueo, el paso 2 de la regla 3: la primera parte de la lógica de negocio. */
  const spyOnLookup = () =>
    vi.spyOn(
      world.app.get<ReservationLookup>(RESERVATION_LOOKUP),
      'findForUpdate',
    );

  beforeAll(async () => {
    world = await CancellationApp.start();
  });

  beforeEach(async () => {
    await world.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await world?.close();
  });

  describe('referencia vacía o nula: 400 "La referencia de la reserva es obligatoria." antes de la lógica de negocio', () => {
    it.each([
      ['vacía', ''],
      ['solo con espacios', '%20%20'],
    ])(
      'la Recepcionista, con la referencia %s',
      async (_case, reservationRef) => {
        const lookup = spyOnLookup();

        const res = await world
          .byReception(reservationRef, {
            updatedAt: EXAMPLE_UPDATED_AT,
            acknowledged: true,
            reason: REASON,
          })
          .expect(400);

        expect(res.body).toMatchObject({
          errorCode: 'RESERVATION_REF_REQUIRED',
          message: 'La referencia de la reserva es obligatoria.',
        });
        expect(lookup).not.toHaveBeenCalled();
        expect(await world.cancellations()).toEqual([]);
      },
    );

    it.each([
      ['vacía', ''],
      ['solo con espacios', '   '],
      ['nula', null],
    ])('Booking, con la referencia %s', async (_case, reservationRef) => {
      const lookup = spyOnLookup();

      await expect(
        world.byBooking(reservationRef as string),
      ).rejects.toMatchObject({
        errorCode: 'RESERVATION_REF_REQUIRED',
        message: 'La referencia de la reserva es obligatoria.',
      });
      expect(lookup).not.toHaveBeenCalled();
      expect(await world.cancellations()).toEqual([]);
    });
  });

  describe('si falla la publicación del aviso REMOVED al Módulo 1', () => {
    it.each([
      ['la Recepcionista', 'RECEPTION'],
      ['Booking', 'OTA_API'],
    ] as const)(
      'la cancelación de %s se conserva y el aviso queda PENDING: nada se revierte',
      async (_who, channel) => {
        // RabbitMQ rechaza toda publicación.
        vi.spyOn(world.app.get(AmqpConnection), 'publish').mockRejectedValue(
          new Error('RabbitMQ no responde'),
        );
        const stored: Reservation =
          channel === 'RECEPTION'
            ? await world.storeDirect()
            : await world.storeBooking();
        await world.sendDailyList();

        if (channel === 'RECEPTION') {
          const res = await world
            .byReception(stored.reservationRef, world.bodyFor(stored))
            .expect(200);
          expect(res.body).toMatchObject({
            reservationRef: stored.reservationRef,
            status: 'CANCELLED',
          });
        } else {
          await world.byBooking(stored.reservationRef);
        }

        const after = await world.stored(stored.reservationRef);
        expect(after.status).toBe('CANCELLED');
        expect(await world.blocksInventory(after)).toEqual([false]);
        expect(await world.cancellations()).toMatchObject([
          { reservation_ref: stored.reservationRef, channel },
        ]);
        expect(await world.listUpdates()).toMatchObject([
          {
            update_type: 'REMOVED',
            removal_reason: 'CANCELLED',
            reservation_ref: stored.reservationRef,
            publish_status: 'PENDING',
          },
        ]);
      },
    );
  });

  it('dos cancelaciones simultáneas de la misma reserva: la primera aplica y la segunda recibe 400 CONCURRENT_UPDATE, con una sola Cancellation y un solo aviso', async () => {
    const stored = await world.storeDirect();
    await world.sendDailyList();
    const body = world.bodyFor(stored);

    const responses = await Promise.all([
      world.byReception(stored.reservationRef, body),
      world.byReception(stored.reservationRef, body),
    ]);

    expect(responses.map((res) => res.status).sort((a, b) => a - b)).toEqual([
      200, 400,
    ]);
    expect(responses.find((res) => res.status === 400)?.body).toMatchObject({
      errorCode: 'CONCURRENT_UPDATE',
      message: 'Esta reserva ya fue actualizada o cancelada recientemente',
    });
    expect((await world.stored(stored.reservationRef)).status).toBe(
      'CANCELLED',
    );
    expect(await world.cancellations()).toHaveLength(1);
    expect(await world.listUpdates()).toMatchObject([
      { update_type: 'REMOVED', reservation_ref: stored.reservationRef },
    ]);
    expect(await world.availabilityMarks()).toHaveLength(1);
  });

  it('varias habitaciones y una ya tuvo Check-In: la reserva está IN_PROGRESS, recibe 400 STATUS_NOT_CANCELLABLE y no cambia nada', async () => {
    const stored = await world.storeDirect({
      status: 'IN_PROGRESS',
      statusReason: 'CHECK_IN',
      rooms: [
        aDirectRoom({ roomNumber: '101', stayStatus: 'CHECKED_IN' }),
        aDirectRoom({ roomNumber: '102' }),
      ],
    });
    await world.sendDailyList();

    const res = await world
      .byReception(stored.reservationRef, world.bodyFor(stored))
      .expect(400);

    expect(res.body).toMatchObject({
      errorCode: 'STATUS_NOT_CANCELLABLE',
      message: 'El estado actual de la reserva no admite cancelación.',
    });
    const after = await world.stored(stored.reservationRef);
    expect(after.status).toBe('IN_PROGRESS');
    expect(after.updatedAt).toBe(stored.updatedAt);
    expect(after.rooms.map((room) => room.stayStatus).sort()).toEqual([
      'CHECKED_IN',
      'EXPECTED',
    ]);
    expect(await world.blocksInventory(after)).toEqual([true, true]);
    expect(await world.cancellations()).toEqual([]);
    expect(await world.listUpdates()).toEqual([]);
    expect(await world.availabilityMarks()).toEqual([]);
  });
});
