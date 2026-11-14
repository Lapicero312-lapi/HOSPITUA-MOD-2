import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../../src/application/ports/out/transaction.js';
import {
  MANAGE_OTA,
  type ManageOta,
} from '../../../../src/application/use-cases/register-ota-information-commission/ports/in/manage-ota.port.js';
import {
  APPLY_OTA_CHANGE,
  type ApplyOtaChange,
} from '../../../../src/application/use-cases/update-reservation/ports/in/apply-ota-change.port.js';
import type {
  Reservation,
  ReservationProps,
} from '../../../../src/domain/reservation/reservation.js';
import { Money } from '../../../../src/domain/shared/money.js';
import {
  aDirectReservation,
  aDirectRoom,
  anOtaReservation,
  anOtaRoom,
} from '../../../support/builders.js';
import { truncateAllTables } from '../../support/database.js';
import {
  type ModificationApp,
  type ModificationHttp,
  modificationHttp,
  plusDays,
  startModificationApp,
  SUITE_305,
} from '../../support/modification-app.js';

/** Un día operativo de 2036, propio de esta prueba. */
const TODAY = '2036-11-01';

/**
 * Escenarios 13 y 14 de la historia 1 de `update-reservation` (T029): las reservas de Booking.
 * - 13: un cambio de Booking sin lugar se guarda con la habitación sin asignar y `NO_ROOM_AVAILABLE`, sin
 *   rechazarlo ni llamar al Módulo 3 (`ApplyOtaChange`, C4 y punto 15).
 * - 14: la Recepcionista asigna la habitación a la reserva en conflicto (B3 y punto 16), y es lo único que
 *   puede cambiarle.
 *
 * La aplicación completa, con PostgreSQL y RabbitMQ reales y los Módulos 1 y 3 simulados en HTTP. La 305 es
 * la única habitación `SUITE` del Módulo 1 simulado.
 */
describe('update-reservation: reservas de Booking (T029, escenarios 13 y 14)', () => {
  let ctx: ModificationApp;
  let api: ModificationHttp;
  let otaId: string;

  /** Una reserva de Booking guardada, en `SUITE`. */
  const storedOta = (changes: Partial<ReservationProps>) =>
    ctx.reservations.insert(anOtaReservation(otaId, changes));

  /** Otra reserva (directa) que ocupa la 305 en esas fechas. */
  const occupy305 = (startDate: string, endDate: string) =>
    ctx.reservations.insert(
      aDirectReservation({
        startDate,
        endDate,
        rooms: [
          aDirectRoom({
            roomId: SUITE_305.id,
            roomNumber: '305',
            categoryRoom: 'SUITE',
            guestCount: 1,
            rate: {
              roomGrossAmount: Money.of('900000.00', 'COP'),
              quoteId: 'Q-305',
            },
          }),
        ],
      }),
    );

  const stateOf = async ({ id }: Reservation) => {
    const [reservation]: Record<string, unknown>[] = await ctx.dataSource.query(
      `SELECT status, start_date::text, end_date::text, conflict_reason FROM reservation WHERE id = $1`,
      [id],
    );
    const rooms: Record<string, unknown>[] = await ctx.dataSource.query(
      `SELECT room_number, blocks_inventory FROM reservation_room WHERE reservation_id = $1`,
      [id],
    );
    return { reservation, rooms };
  };

  const listSentToday = () =>
    ctx.dataSource.query(
      `INSERT INTO daily_sequence (operational_date, last_sequence, list_generated)
       VALUES ($1, 1, true)
       ON CONFLICT (operational_date) DO UPDATE SET list_generated = true`,
      [TODAY],
    );

  const dailyUpdatesOf = ({ id }: Reservation) =>
    ctx.dataSource.query(
      `SELECT update_type FROM daily_list_message WHERE reservation_id = $1 ORDER BY sequence_number`,
      [id],
    );

  beforeAll(async () => {
    ctx = await startModificationApp(TODAY);
    api = modificationHttp(ctx.app);
  });

  beforeEach(async () => {
    ctx.setToday(TODAY);
    ctx.resetModules();
    await truncateAllTables(ctx.dataSource);
    ({ id: otaId } = await ctx.app
      .get<ManageOta>(MANAGE_OTA)
      .register({ name: 'Booking.com' }, new Date(`${TODAY}T15:00:00Z`)));
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('escenario 13: Booking corre la salida y no hay SUITE libre: fechas nuevas, habitación sin asignar y NO_ROOM_AVAILABLE, sin Módulo 3', async () => {
    const start = plusDays(TODAY, 10);
    const end = plusDays(TODAY, 12);
    const reservation = await storedOta({
      startDate: start,
      endDate: end,
      rooms: [
        anOtaRoom({
          roomId: SUITE_305.id,
          roomNumber: '305',
          categoryRoom: 'SUITE',
          guestCount: 2,
        }),
      ],
    });
    // La 305 está ocupada la noche que se agrega.
    await occupy305(end, plusDays(end, 1));
    const otaChanges = ctx.app.get<ApplyOtaChange>(APPLY_OTA_CHANGE);

    const plan = await otaChanges.prepare(reservation, {
      startDate: start,
      endDate: plusDays(end, 1),
      rooms: [{ categoryRoom: 'SUITE', guestCount: 2 }],
      // Una sola habitación: no hay fechas distintas entre habitaciones.
      datesDifferPerRoom: false,
      grossAmount: reservation.ota?.grossAmount ?? Money.of('0', 'USD'),
      notes: reservation.notes,
      guest: {
        firstName: reservation.guest.firstName,
        lastName: reservation.guest.lastName,
        contactEmail: reservation.guest.contactEmail,
        contactPhone: reservation.guest.contactPhone,
        nationality: reservation.guest.nationality,
      },
    });
    await ctx.app
      .get<TransactionRunner>(TRANSACTION_RUNNER)
      .run((tx) => otaChanges.apply(tx, plan));

    expect(await stateOf(reservation)).toEqual({
      reservation: {
        status: 'ACTIVE',
        start_date: start,
        end_date: plusDays(end, 1),
        conflict_reason: 'NO_ROOM_AVAILABLE',
      },
      rooms: [{ room_number: null, blocks_inventory: false }],
    });
    expect(ctx.modules.quotedTypes).toEqual([]);
  });

  describe('escenario 14: la Recepcionista asigna la habitación', () => {
    /** Una reserva de Booking en conflicto, con su habitación de SUITE sin asignar, que llega hoy. */
    const inConflict = () =>
      storedOta({
        startDate: TODAY,
        endDate: plusDays(TODAY, 2),
        rooms: [
          anOtaRoom({
            roomId: null,
            roomNumber: null,
            categoryRoom: 'SUITE',
            guestCount: 2,
          }),
        ],
        conflict: {
          reason: 'NO_ROOM_AVAILABLE',
          detectedAt: new Date(`${TODAY}T08:00:00Z`),
        },
      });

    const assign = (reservationRef: string, body: object) =>
      request(ctx.app.getHttpServer())
        .patch(`/api/reservations/${reservationRef}/room-assignment`)
        .set('X-User', 'Laura Méndez')
        .send(body);

    it('con la 305 libre y llegada hoy: verifica, asigna, quita el conflicto y avisa ADDED a la lista del día', async () => {
      await listSentToday();
      const reservation = await inConflict();
      const { body: detail } = await api
        .detail(reservation.reservationRef)
        .expect(200);
      expect(await dailyUpdatesOf(reservation)).toEqual([]);

      const res = await assign(reservation.reservationRef, {
        updatedAt: detail.updatedAt,
        assignments: [
          {
            reservationRoomId: detail.rooms[0].reservationRoomId,
            roomId: SUITE_305.id,
          },
        ],
      }).expect(200);

      expect(res.body).toMatchObject({
        conflict: null,
        rooms: [expect.objectContaining({ roomNumber: '305' })],
      });
      expect(await stateOf(reservation)).toEqual({
        reservation: expect.objectContaining({ conflict_reason: null }),
        rooms: [{ room_number: '305', blocks_inventory: true }],
      });
      // Verificó la disponibilidad de la 305 con el Módulo 1.
      expect(ctx.modules.maintenanceCalls).toBeGreaterThan(0);
      expect(await dailyUpdatesOf(reservation)).toEqual([
        { update_type: 'ADDED' },
      ]);
    });

    it('con la 305 ocupada: ROOM_NOT_AVAILABLE y la reserva sigue en conflicto', async () => {
      const reservation = await inConflict();
      await occupy305(TODAY, plusDays(TODAY, 2));
      const { body: detail } = await api
        .detail(reservation.reservationRef)
        .expect(200);

      const res = await assign(reservation.reservationRef, {
        updatedAt: detail.updatedAt,
        assignments: [
          {
            reservationRoomId: detail.rooms[0].reservationRoomId,
            roomId: SUITE_305.id,
          },
        ],
      }).expect(400);

      expect(res.body).toMatchObject({ errorCode: 'ROOM_NOT_AVAILABLE' });
      expect(await stateOf(reservation)).toEqual({
        reservation: expect.objectContaining({
          conflict_reason: 'NO_ROOM_AVAILABLE',
        }),
        rooms: [{ room_number: null, blocks_inventory: false }],
      });
    });

    it('la Recepcionista no puede cambiar ningún otro dato: la modificación (B1 y B2) responde OTA_RESERVATION_READ_ONLY', async () => {
      const reservation = await inConflict();
      const { body: detail } = await api
        .detail(reservation.reservationRef)
        .expect(200);
      const before = await stateOf(reservation);

      for (const call of [api.preview, api.confirm]) {
        const { body } = await call(reservation.reservationRef, {
          updatedAt: detail.updatedAt,
          notes: 'Otra nota',
          expectedRates: [],
        }).expect(400);
        expect(body).toMatchObject({
          errorCode: 'OTA_RESERVATION_READ_ONLY',
          message:
            'Las reservas de OTA solo las modifica Booking. Si está en conflicto, solo se le puede asignar la habitación.',
        });
      }
      expect(await stateOf(reservation)).toEqual(before);
    });
  });
});
