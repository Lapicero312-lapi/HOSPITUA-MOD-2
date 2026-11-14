import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { BookingRevision } from '../../../src/application/integration/booking-revision.js';
import {
  OTA_REPOSITORY,
  type OtaRepository,
} from '../../../src/application/ports/out/ota.repository.js';
import {
  GENERATE_DAILY_LIST,
  type GenerateDailyList,
} from '../../../src/application/use-cases/check-view-reservation/ports/in/generate-daily-list.port.js';
import {
  PROCESS_BOOKING_REVISION,
  type ProcessBookingRevision,
} from '../../../src/application/use-cases/generate-ota-reservation/ports/in/process-booking-revision.port.js';
import {
  APPLY_OTA_CHANGE,
  type ApplyOtaChange,
} from '../../../src/application/use-cases/update-reservation/ports/in/apply-ota-change.port.js';
import {
  CLOSE_DAY,
  type CloseDay,
} from '../../../src/application/use-cases/update-reservation/ports/in/close-day.port.js';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../src/application/ports/out/transaction.js';
import type { Reservation } from '../../../src/domain/reservation/reservation.js';
import { Money } from '../../../src/domain/shared/money.js';
import {
  aDirectReservation,
  aDirectRoom,
  aGuest,
  anOta,
  anOtaReservation,
  anOtaRoom,
  otaTerms,
} from '../../support/builders.js';
import {
  type ModificationApp,
  modificationHttp,
  type ModificationHttp,
  plusDays,
  ROOM_203,
  startModificationApp,
  SUITE_305,
} from '../support/modification-app.js';
import { ROOM_201 } from '../../support/rooms.js';
import { truncateAllTables } from '../support/database.js';

/** El día operativo de la prueba; la lista del día ya salió en cada escenario. */
const TODAY = '2034-07-10';

/** El tipo de habitación de Channex de DOBLE (la fila la crea la prueba). */
const DOBLE_TYPE = '994d1375-dbbd-4072-8724-b2ab32ce781b';

type UpdateRow = {
  sequence_number: number;
  update_type: string;
  removal_reason: string | null;
  reservation_ref: string;
  publish_status: string;
  payload: Record<string, unknown>;
};

/**
 * T030 de `check-view-reservation`: los escenarios 1 a 8 de la historia 5 del spec (las actualizaciones de la
 * lista del día), incluido el 6a (habitación sin asignar), con lo que pide su fila en "Pruebas por
 * escenario" del plan. Cada cambio entra por el flujo real que lo produce: la creación de la reserva directa
 * (`POST /api/reservations/direct`), una revisión de Booking (`ProcessBookingRevision`), la modificación
 * (`modification-preview` y `PATCH`), la cancelación (`POST …/cancellation`), el cierre del día (`CloseDay`),
 * un cambio de Booking (`ApplyOtaChange`) y la asignación de habitación (`PATCH …/room-assignment`). La
 * aplicación completa, PostgreSQL, RabbitMQ y los Módulos 1 y 3 simulados (`modification-app`). Se revisa
 * cada actualización guardada para el Módulo 1 y que haya quedado publicada.
 */
describe('check-view-reservation: escenarios 1 a 8 de la historia 5, las actualizaciones de la lista del día (T030)', () => {
  let ctx: ModificationApp;
  let api: ModificationHttp;
  /** La reserva directa de hoy que ya viajó en la lista, con la 201 y 2 personas. */
  let listed: Reservation;
  /** La 201 de DOBLE, que responde el Módulo 1 simulado. */
  const room201 = ROOM_201.id;

  const updates = (): Promise<UpdateRow[]> =>
    ctx.dataSource.query(
      `SELECT m.sequence_number, m.update_type, m.removal_reason, r.reservation_ref, m.publish_status,
              m.payload
       FROM daily_list_message m JOIN reservation r ON r.id = m.reservation_id
       WHERE m.operational_date = $1 AND m.message_kind = 'UPDATE'
       ORDER BY m.sequence_number`,
      [TODAY],
    );

  /** Las actualizaciones de hoy, una vez publicadas todas (salen apenas se confirma cada cambio). */
  async function publishedUpdates(count: number): Promise<UpdateRow[]> {
    await vi.waitFor(
      async () => {
        const rows = await updates();
        expect(rows).toHaveLength(count);
        expect(rows.every((row) => row.publish_status === 'PUBLISHED')).toBe(
          true,
        );
      },
      { timeout: 10_000, interval: 50 },
    );
    return updates();
  }

  const sendList = (day = TODAY) =>
    ctx.app.get<GenerateDailyList>(GENERATE_DAILY_LIST).execute(day);

  const updatedAtOf = async (reservationRef: string) =>
    (await api.detail(reservationRef).expect(200)).body.updatedAt as string;

  /** La cancelación de la Recepcionista (A de `cancel-reservation`), con el `updatedAt` que leyó la pantalla. */
  const cancel = async (reservationRef: string) => {
    const updatedAt = await updatedAtOf(reservationRef);
    await request(ctx.app.getHttpServer())
      .post(`/api/reservations/${reservationRef}/cancellation`)
      .set('X-User', 'Laura Méndez')
      .send({ updatedAt, acknowledged: true })
      .expect(200);
  };

  /** Una revisión `new` de Booking con llegada hoy, una habitación DOBLE de 2 personas. */
  const aBookingRevision = (code: string): BookingRevision => ({
    id: randomUUID(),
    bookingId: randomUUID(),
    otaReservationCode: code,
    otaName: 'Booking.com',
    status: 'new',
    arrivalDate: TODAY,
    departureDate: plusDays(TODAY, 2),
    amount: Money.of('220.00', 'USD'),
    otaCommission: Money.of('33.00', 'USD'),
    notes: null,
    customer: {
      name: 'Ana',
      surname: 'Pérez',
      mail: 'ana@correo.com',
      phone: '+57 300 000 0000',
      country: 'CO',
    },
    rooms: [
      {
        roomTypeId: DOBLE_TYPE,
        ratePlanId: null,
        checkinDate: TODAY,
        checkoutDate: plusDays(TODAY, 2),
        adults: 2,
        children: 0,
        infants: 0,
      },
    ],
  });

  beforeAll(async () => {
    ctx = await startModificationApp(TODAY);
    api = modificationHttp(ctx.app);
  });

  beforeEach(async () => {
    ctx.setToday(TODAY);
    ctx.resetModules();
    await truncateAllTables(ctx.dataSource);
    listed = await ctx.reservations.insert(
      aDirectReservation({
        startDate: TODAY,
        endDate: plusDays(TODAY, 2),
        rooms: [
          aDirectRoom({ roomId: room201, roomNumber: '201', guestCount: 2 }),
        ],
        guest: aGuest({ firstName: 'Ana', lastName: 'Pérez' }),
      }),
    );
    expect(await sendList()).toBe(true);
  });

  afterAll(async () => {
    if (ctx !== undefined) {
      await truncateAllTables(ctx.dataSource);
      await ctx.close();
    }
  });

  it('escenario 1: una reserva directa nueva para hoy, creada por la Recepcionista: ADDED con el detalle completo', async () => {
    const res = await request(ctx.app.getHttpServer())
      .post('/api/reservations/direct')
      .set('Idempotency-Key', randomUUID())
      .send({
        startDate: TODAY,
        endDate: plusDays(TODAY, 2),
        categoryRoom: 'DOBLE',
        rooms: [{ guestCount: 2 }],
        guest: {
          firstName: 'Valentina',
          lastName: 'Ospina',
          documentType: 'CC',
          documentNumber: '1144093552',
          nationality: 'Colombia',
          contactPhone: '+57 300 000 0000',
          contactEmail: 'valentina@correo.com',
        },
        notes: null,
        expectedRates: [
          { position: 1, lodgingAmount: '600000.00', currency: 'COP' },
        ],
      })
      .expect(201);

    const [added] = await publishedUpdates(1);

    expect(added).toMatchObject({
      sequence_number: 2,
      update_type: 'ADDED',
      reservation_ref: res.body.reservationRef,
    });
    expect(added.payload).toMatchObject({
      sequenceNumber: 2,
      operationalDate: TODAY,
      updateType: 'ADDED',
      reservationRef: res.body.reservationRef,
      reservation: {
        reservationRef: res.body.reservationRef,
        status: 'ACTIVE',
        source: 'DIRECTA',
        startDate: TODAY,
        guestCount: 2,
        rooms: [{ categoryRoom: 'DOBLE', guestCount: 2 }],
        guest: { fullName: 'Valentina Ospina', documentNumber: '1144093552' },
      },
    });
  });

  it('escenario 2: una reserva de Booking con llegada hoy que entra por el feed: ADDED con el detalle completo', async () => {
    await ctx.dataSource.query(
      `INSERT INTO ota_room_type_mapping (channex_room_type_id, category_room, count_of_rooms, occupancy)
       VALUES ($1, 'DOBLE', 3, 2)`,
      [DOBLE_TYPE],
    );

    expect(
      await ctx.app
        .get<ProcessBookingRevision>(PROCESS_BOOKING_REVISION)
        .process(aBookingRevision('9996013801')),
    ).toEqual({ kind: 'ACKNOWLEDGE' });

    const [added] = await publishedUpdates(1);
    expect(added.update_type).toBe('ADDED');
    expect(added.payload).toMatchObject({
      updateType: 'ADDED',
      reservation: {
        source: 'BOOKING',
        externalConfirmationCode: '9996013801',
        guestCount: 2,
        guest: { fullName: 'Ana Pérez' },
      },
    });
  });

  it('escenario 3: agregar una habitación con 2 personas a una de la lista: UPDATED con el detalle vigente, 2 habitaciones y 4 personas', async () => {
    const { confirmed } = await api.previewAndConfirm(listed.reservationRef, {
      updatedAt: listed.updatedAt,
      rooms: [
        { roomId: room201, guestCount: 2 },
        { roomId: ROOM_203.id, guestCount: 2 },
      ],
    });
    expect(confirmed.status).toBe(200);

    const [updated] = await publishedUpdates(1);

    expect(updated).toMatchObject({
      update_type: 'UPDATED',
      reservation_ref: listed.reservationRef,
    });
    const reservation = updated.payload.reservation as {
      guestCount: number;
      rooms: { roomNumber: string; guestCount: number }[];
    };
    expect(reservation.guestCount).toBe(4);
    expect(
      reservation.rooms
        .map(({ roomNumber, guestCount }) => [roomNumber, guestCount])
        .sort(),
    ).toEqual([
      ['201', 2],
      ['203', 2],
    ]);
  });

  it('escenario 4: cancelar una de la lista: REMOVED con la reservationRef y el motivo CANCELLED, sin el detalle', async () => {
    await cancel(listed.reservationRef);

    const [removed] = await publishedUpdates(1);

    expect(removed).toMatchObject({
      update_type: 'REMOVED',
      removal_reason: 'CANCELLED',
      reservation_ref: listed.reservationRef,
    });
    expect(removed.payload).toMatchObject({
      updateType: 'REMOVED',
      reservationRef: listed.reservationRef,
      removalReason: 'CANCELLED',
    });
    expect(removed.payload).not.toHaveProperty('reservation');
  });

  it('escenario 5: mover la llegada a mañana: REMOVED con DATE_CHANGED, y la reserva viaja en la lista de mañana', async () => {
    const tomorrow = plusDays(TODAY, 1);

    const { confirmed } = await api.previewAndConfirm(listed.reservationRef, {
      updatedAt: listed.updatedAt,
      startDate: tomorrow,
      endDate: plusDays(TODAY, 3),
    });
    expect(confirmed.status).toBe(200);

    const [removed] = await publishedUpdates(1);
    expect(removed).toMatchObject({
      update_type: 'REMOVED',
      removal_reason: 'DATE_CHANGED',
    });
    await sendList(tomorrow);
    const [{ refs }]: { refs: string[] }[] = await ctx.dataSource.query(
      `SELECT array(SELECT jsonb_array_elements(payload->'reservations')->>'reservationRef') AS refs
       FROM daily_list_message WHERE operational_date = $1 AND message_kind = 'LIST'`,
      [tomorrow],
    );
    expect(refs).toEqual([listed.reservationRef]);
  });

  it('escenario 6: el cierre del día la marca NO_SHOW sin Check-In: REMOVED con NO_SHOW, en la lista del día cerrado', async () => {
    // El cierre corre a las 00:00:30 del día siguiente y procesa el día que terminó.
    ctx.setToday(plusDays(TODAY, 1));

    await ctx.app.get<CloseDay>(CLOSE_DAY).execute(TODAY);

    const [removed] = await publishedUpdates(1);
    expect(removed).toMatchObject({
      update_type: 'REMOVED',
      removal_reason: 'NO_SHOW',
      reservation_ref: listed.reservationRef,
    });
    expect(removed.payload.operationalDate).toBe(TODAY);
  });

  it('escenario 6a: un cambio de Booking que deja una habitación sin asignar: REMOVED con ROOM_UNASSIGNED; al asignarla, ADDED', async () => {
    // Otro día empezado de cero: una de Booking en la lista de hoy, con la 201 de DOBLE.
    await truncateAllTables(ctx.dataSource);
    const agency = await ctx.app
      .get<OtaRepository>(OTA_REPOSITORY)
      .insert(anOta({ name: 'Booking.com' }));
    const booking = await ctx.reservations.insert(
      anOtaReservation(agency.id, {
        startDate: TODAY,
        endDate: plusDays(TODAY, 2),
        rooms: [
          anOtaRoom({ roomId: room201, roomNumber: '201', guestCount: 2 }),
        ],
        ota: otaTerms(agency.id, { externalConfirmationCode: '9996013802' }),
      }),
    );
    // La única SUITE (305) ocupada por otra reserva que llegó ayer: no viaja en la lista de hoy.
    const blocker = await ctx.reservations.insert(
      aDirectReservation({
        startDate: plusDays(TODAY, -1),
        endDate: plusDays(TODAY, 3),
        rooms: [
          aDirectRoom({
            roomId: SUITE_305.id,
            roomNumber: '305',
            categoryRoom: 'SUITE',
          }),
        ],
      }),
    );
    expect(await sendList()).toBe(true);

    // Booking la cambia a una SUITE: no hay lugar y queda sin asignar.
    const changes = ctx.app.get<ApplyOtaChange>(APPLY_OTA_CHANGE);
    const plan = await changes.prepare(booking, {
      startDate: TODAY,
      endDate: plusDays(TODAY, 2),
      rooms: [{ categoryRoom: 'SUITE', guestCount: 2 }],
      grossAmount: booking.ota!.grossAmount,
      notes: null,
      guest: {
        firstName: booking.guest.firstName,
        lastName: booking.guest.lastName,
        contactEmail: null,
        contactPhone: null,
        nationality: null,
      },
      datesDifferPerRoom: false,
    });
    expect(plan.conflictReason).toBe('NO_ROOM_AVAILABLE');
    await ctx.app
      .get<TransactionRunner>(TRANSACTION_RUNNER)
      .run((tx) => changes.apply(tx, plan));

    const [removed] = await publishedUpdates(1);
    expect(removed).toMatchObject({
      update_type: 'REMOVED',
      removal_reason: 'ROOM_UNASSIGNED',
      reservation_ref: booking.reservationRef,
    });

    // Se libera la 305 y la Recepcionista la asigna.
    await cancel(blocker.reservationRef);
    const detail = (await api.detail(booking.reservationRef).expect(200))
      .body as {
      updatedAt: string;
      rooms: { reservationRoomId: string; roomId: string | null }[];
    };
    const unassigned = detail.rooms.find(({ roomId }) => roomId === null);
    await request(ctx.app.getHttpServer())
      .patch(`/api/reservations/${booking.reservationRef}/room-assignment`)
      .set('X-User', 'Laura Méndez')
      .send({
        updatedAt: detail.updatedAt,
        assignments: [
          {
            reservationRoomId: unassigned?.reservationRoomId,
            roomId: SUITE_305.id,
          },
        ],
      })
      .expect(200);

    const rows = await publishedUpdates(2);
    expect(rows.map(({ update_type }) => update_type)).toEqual([
      'REMOVED',
      'ADDED',
    ]);
    expect(rows[1].payload).toMatchObject({
      reservation: {
        reservationRef: booking.reservationRef,
        rooms: [{ roomNumber: '305', categoryRoom: 'SUITE' }],
      },
    });
  });

  it('escenario 7: dos cambios seguidos de la misma reserva (personas y después la cancelación): UPDATED y después REMOVED, con secuencias crecientes', async () => {
    const { confirmed } = await api.previewAndConfirm(listed.reservationRef, {
      updatedAt: listed.updatedAt,
      rooms: [{ roomId: room201, guestCount: 1 }],
    });
    expect(confirmed.status).toBe(200);
    await cancel(listed.reservationRef);

    const rows = await publishedUpdates(2);

    expect(
      rows.map(({ sequence_number, update_type }) => [
        sequence_number,
        update_type,
      ]),
    ).toEqual([
      [2, 'UPDATED'],
      [3, 'REMOVED'],
    ]);
    // Se publicaron en ese orden.
    const published: { sequence_number: number }[] = await ctx.dataSource.query(
      `SELECT sequence_number FROM daily_list_message
       WHERE operational_date = $1 AND message_kind = 'UPDATE' ORDER BY published_at, sequence_number`,
      [TODAY],
    );
    expect(published.map(({ sequence_number }) => sequence_number)).toEqual([
      2, 3,
    ]);
  });

  it('escenario 8: cambiar las personas de una reserva que llega dentro de una semana no genera ninguna actualización hoy', async () => {
    const later = await ctx.reservations.insert(
      aDirectReservation({
        startDate: plusDays(TODAY, 7),
        endDate: plusDays(TODAY, 9),
        rooms: [
          aDirectRoom({ roomId: room201, roomNumber: '201', guestCount: 2 }),
        ],
      }),
    );

    const { confirmed } = await api.previewAndConfirm(later.reservationRef, {
      updatedAt: later.updatedAt,
      rooms: [{ roomId: room201, guestCount: 1 }],
    });
    expect(confirmed.status).toBe(200);

    expect(await updates()).toEqual([]);
  });
});
