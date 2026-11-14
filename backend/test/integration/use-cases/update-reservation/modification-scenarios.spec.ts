import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Room } from '../../../../src/application/integration/room.js';
import {
  CLOSE_DAY,
  type CloseDay,
} from '../../../../src/application/use-cases/update-reservation/ports/in/close-day.port.js';
import {
  PROCESS_CHECK_IN,
  type ProcessCheckIn,
} from '../../../../src/application/use-cases/update-reservation/ports/in/process-check-in.port.js';
import {
  PROCESS_CHECK_OUT,
  type ProcessCheckOut,
} from '../../../../src/application/use-cases/update-reservation/ports/in/process-check-out.port.js';
import type { Reservation } from '../../../../src/domain/reservation/reservation.js';
import { Money } from '../../../../src/domain/shared/money.js';
import { INBOUND_QUEUES } from '../../../../src/infrastructure/config/rabbitmq.topology.js';
import { aDirectReservation, aDirectRoom } from '../../../support/builders.js';
import { ROOM_201, ROOM_202 } from '../../../support/rooms.js';
import { truncateAllTables } from '../../support/database.js';
import {
  ELEVEN_ROOMS,
  type ModificationApp,
  type ModificationHttp,
  modificationHttp,
  plusDays,
  ROOM_203,
  startModificationApp,
  SUITE_305,
} from '../../support/modification-app.js';

/** Un día operativo de 2036, propio de esta prueba; la estadía de siempre, de dos noches, días después. */
const TODAY = '2036-08-01';
const START = '2036-08-20';
const END = '2036-08-22';

const NOT_EDITABLE = 'El estado actual de la reserva no admite modificaciones.';

/**
 * Escenarios 1 a 12 de la historia 1 de `update-reservation` y sus casos borde (T013), con la aplicación
 * completa: las llamadas HTTP de B1 y B2 como las hace la pantalla, PostgreSQL y RabbitMQ reales y los
 * Módulos 1 y 3 simulados en HTTP. Cada prueba empieza con la base vacía.
 */
describe('update-reservation: escenarios de la modificación (T013)', () => {
  let ctx: ModificationApp;
  let api: ModificationHttp;
  let sequence = 0;

  /** Una habitación guardada de la reserva, con su tarifa. */
  const roomOf = (room: Room, guestCount: number, amount = '600000.00') =>
    aDirectRoom({
      roomId: room.id,
      roomNumber: room.roomNumber,
      categoryRoom: room.categoryRoom,
      guestCount,
      rate: {
        roomGrossAmount: Money.of(amount, 'COP'),
        quoteId: `Q-${room.roomNumber}`,
      },
    });

  /** Una reserva directa `ACTIVE` guardada, de dos noches con la 201 y 2 personas salvo que diga otra cosa. */
  const stored = (changes: Parameters<typeof aDirectReservation>[0] = {}) =>
    ctx.reservations.insert(
      aDirectReservation({
        startDate: START,
        endDate: END,
        rooms: [roomOf(ROOM_201, 2)],
        ...changes,
      }),
    );

  const reservationRowOf = async ({ id }: Reservation) => {
    const [row]: Record<string, unknown>[] = await ctx.dataSource.query(
      `SELECT status, start_date::text, end_date::text, guest_count, notes, updated_at::text
       FROM reservation WHERE id = $1`,
      [id],
    );
    return row;
  };
  const roomRowsOf = ({ id }: Reservation) =>
    ctx.dataSource.query(
      `SELECT room_number, guest_count, room_gross_amount::text AS amount, stay_status,
              start_date::text AS start_date, end_date::text AS end_date, blocks_inventory
       FROM reservation_room WHERE reservation_id = $1 ORDER BY room_number`,
      [id],
    ) as Promise<Record<string, unknown>[]>;
  /** Todo lo guardado de la reserva: para comprobar que un rechazo no cambió nada. */
  const snapshotOf = async (reservation: Reservation) => ({
    reservation: await reservationRowOf(reservation),
    rooms: await roomRowsOf(reservation),
  });

  /** La lista del día de hoy ya se envió: los cambios que la tocan se avisan (T012). */
  const listSentToday = () =>
    ctx.dataSource.query(
      `INSERT INTO daily_sequence (operational_date, last_sequence, list_generated)
       VALUES ($1, 1, true)
       ON CONFLICT (operational_date) DO UPDATE SET list_generated = true`,
      [TODAY],
    );
  const dailyUpdatesOf = ({ id }: Reservation) =>
    ctx.dataSource.query(
      `SELECT update_type, removal_reason FROM daily_list_message
       WHERE reservation_id = $1 ORDER BY sequence_number`,
      [id],
    ) as Promise<{ update_type: string; removal_reason: string | null }[]>;

  /** Una notificación de Check-In o Check-Out del Módulo 1 de una habitación de la reserva. */
  const stayNotification = (
    reservation: Reservation,
    room: Room,
    queue: string,
    movementDate: string,
  ) => ({
    messageId: randomUUID(),
    sequenceNumber: ++sequence,
    queue,
    reservationRef: reservation.reservationRef,
    roomId: room.id,
    movementDate,
    guests: [
      {
        firstName: 'Ana',
        lastName: 'Pérez',
        documentType: 'CC',
        documentNumber: '52123456',
        birthDate: '1990-05-12',
        nationality: 'Colombia',
      },
    ],
  });
  const checkIn = (reservation: Reservation, room: Room = ROOM_201) =>
    ctx.app
      .get<ProcessCheckIn>(PROCESS_CHECK_IN)
      .execute(
        stayNotification(
          reservation,
          room,
          INBOUND_QUEUES.CHECK_IN.name,
          reservation.startDate,
        ),
      );
  const checkOut = (reservation: Reservation, room: Room = ROOM_201) =>
    ctx.app
      .get<ProcessCheckOut>(PROCESS_CHECK_OUT)
      .execute(
        stayNotification(
          reservation,
          room,
          INBOUND_QUEUES.CHECK_OUT.name,
          reservation.endDate,
        ),
      );
  const cancel = async (reservation: Reservation) => {
    const { body } = await api.detail(reservation.reservationRef).expect(200);
    await request(ctx.app.getHttpServer())
      .post(`/api/reservations/${reservation.reservationRef}/cancellation`)
      .set('X-User', 'Laura Méndez')
      .send({ updatedAt: body.updatedAt, acknowledged: true })
      .expect(200);
  };
  /** El `updatedAt` de ahora, como lo leería la pantalla en C3. */
  const updatedAtOf = async (reservation: Reservation) =>
    (await api.detail(reservation.reservationRef).expect(200)).body
      .updatedAt as string;

  beforeAll(async () => {
    ctx = await startModificationApp(TODAY);
    api = modificationHttp(ctx.app);
  });

  beforeEach(async () => {
    ctx.setToday(TODAY);
    ctx.resetModules();
    await truncateAllTables(ctx.dataSource);
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe('escenario 1: recotización exitosa', () => {
    it('cambiar las fechas: la vista previa cotiza la habitación afectada y, tras confirmar, se guarda la tarifa nueva', async () => {
      const reservation = await stored();
      const endDate = plusDays(END, 1);

      const { shown, confirmed } = await api.previewAndConfirm(
        reservation.reservationRef,
        { updatedAt: reservation.updatedAt, endDate },
      );

      expect(shown.body.quotes).toMatchObject({
        rooms: [
          {
            key: ROOM_201.id,
            categoryRoom: 'DOBLE',
            nights: 3,
            lodgingAmount: { amount: '900000.00', currency: 'COP' },
          },
        ],
        total: { amount: '900000.00', currency: 'COP' },
      });
      expect(shown.body.requiresConfirmation).toBe(true);
      expect(confirmed.status).toBe(200);
      expect(await roomRowsOf(reservation)).toEqual([
        {
          room_number: '201',
          guest_count: 2,
          amount: '900000.00',
          stay_status: 'EXPECTED',
          start_date: START,
          end_date: endDate,
          blocks_inventory: true,
        },
      ]);
      expect(await reservationRowOf(reservation)).toMatchObject({
        start_date: START,
        end_date: endDate,
      });
    });

    it('cambiar la categoría (la 201 por la 305 SUITE): cotiza solo la SUITE y la guarda con su tarifa', async () => {
      const reservation = await stored();
      ctx.modules.nightly = '480000.00';

      const { shown, confirmed } = await api.previewAndConfirm(
        reservation.reservationRef,
        {
          updatedAt: reservation.updatedAt,
          rooms: [{ roomId: SUITE_305.id, guestCount: 2 }],
        },
      );

      expect(
        (shown.body.quotes.rooms as { key: string }[]).map(({ key }) => key),
      ).toEqual([SUITE_305.id]);
      // Una cotización en la vista previa y otra en la confirmación, las dos de SUITE.
      expect(ctx.modules.quotedTypes).toEqual(['SUITE', 'SUITE']);
      expect(confirmed.status).toBe(200);
      expect(await roomRowsOf(reservation)).toEqual([
        expect.objectContaining({
          room_number: '305',
          guest_count: 2,
          amount: '960000.00',
        }),
      ]);
    });
  });

  describe('escenario 2: datos personales', () => {
    it.each(['ACTIVE', 'PENDING'] as const)(
      'en %s: guarda el titular sin llamar al Módulo 3 ni verificar disponibilidad, y no cambia fechas ni habitaciones',
      async (status) => {
        const reservation = await stored({ status });
        const before = await roomRowsOf(reservation);
        const guest = {
          firstName: 'Ana María',
          lastName: 'Pérez Gómez',
          documentType: 'CC',
          documentNumber: '52123456',
          contactPhone: '+57 311 000 0000',
          contactEmail: 'ana.maria@correo.com',
        };

        const { confirmed } = await api.previewAndConfirm(
          reservation.reservationRef,
          { updatedAt: reservation.updatedAt, guest },
        );

        expect(confirmed.status).toBe(200);
        expect(confirmed.body.guest).toMatchObject(guest);
        expect(ctx.modules.quotedTypes).toEqual([]);
        expect(ctx.modules.maintenanceCalls).toBe(0);
        expect(await roomRowsOf(reservation)).toEqual(before);
        expect(await reservationRowOf(reservation)).toMatchObject({
          status,
          start_date: START,
          end_date: END,
        });
      },
    );
  });

  describe('escenario 3: cambio de estado por un proceso interno', () => {
    it('Check-In: IN_PROGRESS; Check-Out: COMPLETED; un Check-In sobre la reserva ya terminada se rechaza sin cambios', async () => {
      const reservation = await stored({
        startDate: TODAY,
        endDate: plusDays(TODAY, 2),
      });

      expect(await checkIn(reservation)).toBe('APPLIED');
      expect(await reservationRowOf(reservation)).toMatchObject({
        status: 'IN_PROGRESS',
      });
      expect(await checkOut(reservation)).toBe('APPLIED');
      expect(await reservationRowOf(reservation)).toMatchObject({
        status: 'COMPLETED',
      });

      const before = await snapshotOf(reservation);
      expect(await checkIn(reservation)).not.toBe('APPLIED');
      expect(await snapshotOf(reservation)).toEqual(before);
    });

    it('cierre del día: la reserva que no se presentó pasa a NO_SHOW; un Check-Out sin ingreso se rechaza', async () => {
      const yesterday = plusDays(TODAY, -1);
      const noShow = await stored({
        startDate: yesterday,
        endDate: plusDays(TODAY, 1),
      });

      // Otra reserva, en la 203, que nunca ingresó: su Check-Out se rechaza.
      const neverArrived = await stored({
        startDate: TODAY,
        endDate: plusDays(TODAY, 1),
        rooms: [roomOf(ROOM_203, 1)],
      });
      expect(await checkOut(neverArrived, ROOM_203)).not.toBe('APPLIED');
      expect(await reservationRowOf(neverArrived)).toMatchObject({
        status: 'ACTIVE',
      });
      await ctx.app.get<CloseDay>(CLOSE_DAY).execute(yesterday);

      expect(await reservationRowOf(noShow)).toMatchObject({
        status: 'NO_SHOW',
      });
    });
  });

  it('escenario 4 y caso borde "una sola habitación no disponible": 400 ROOM_NOT_AVAILABLE con su número y no se aplica nada', async () => {
    const reservation = await stored({
      rooms: [roomOf(ROOM_201, 2), roomOf(ROOM_202, 2)],
    });
    // Otra reserva ocupa la 202 la noche que se agrega.
    await stored({
      startDate: END,
      endDate: plusDays(END, 1),
      rooms: [roomOf(ROOM_202, 1)],
    });
    const before = await snapshotOf(reservation);

    const res = await api
      .preview(reservation.reservationRef, {
        updatedAt: reservation.updatedAt,
        endDate: plusDays(END, 1),
      })
      .expect(400);
    const confirmed = await api
      .confirm(reservation.reservationRef, {
        updatedAt: reservation.updatedAt,
        endDate: plusDays(END, 1),
        expectedRates: [],
      })
      .expect(400);

    for (const { body } of [res, confirmed]) {
      expect(body).toMatchObject({
        errorCode: 'ROOM_NOT_AVAILABLE',
        message:
          'La habitación 202 no está disponible para el rango de fechas solicitado.',
      });
    }
    expect(await snapshotOf(reservation)).toEqual(before);
  });

  describe('escenario 5: estados que no se editan', () => {
    const reach = {
      IN_PROGRESS: async (reservation: Reservation) => {
        await checkIn(reservation);
      },
      COMPLETED: async (reservation: Reservation) => {
        await checkIn(reservation);
        await checkOut(reservation);
      },
      CANCELLED: (reservation: Reservation) => cancel(reservation),
      NO_SHOW: async () => {
        await ctx.app.get<CloseDay>(CLOSE_DAY).execute(plusDays(TODAY, -1));
      },
    };

    it.each(Object.keys(reach) as (keyof typeof reach)[])(
      '%s: 400 STATUS_NOT_EDITABLE en la vista previa y en la confirmación',
      async (status) => {
        const startDate = status === 'NO_SHOW' ? plusDays(TODAY, -1) : TODAY;
        const reservation = await stored({
          startDate,
          endDate: plusDays(TODAY, 2),
        });
        await reach[status](reservation);
        const updatedAt = await updatedAtOf(reservation);
        expect(await reservationRowOf(reservation)).toMatchObject({ status });
        const before = await snapshotOf(reservation);

        for (const call of [api.preview, api.confirm]) {
          const { body } = await call(reservation.reservationRef, {
            updatedAt,
            notes: 'Otra nota',
            expectedRates: [],
          }).expect(400);
          expect(body).toMatchObject({
            errorCode: 'STATUS_NOT_EDITABLE',
            message: NOT_EDITABLE,
          });
        }
        expect(await snapshotOf(reservation)).toEqual(before);
      },
    );
  });

  describe('escenarios 6 y 7: cambio de habitación', () => {
    it('6: con llegada hoy, cambia a la 202 y avisa UPDATED a la lista del día', async () => {
      await listSentToday();
      const reservation = await stored({
        startDate: TODAY,
        endDate: plusDays(TODAY, 2),
      });

      const { confirmed } = await api.previewAndConfirm(
        reservation.reservationRef,
        {
          updatedAt: reservation.updatedAt,
          rooms: [{ roomId: ROOM_202.id, guestCount: 2 }],
        },
      );

      expect(confirmed.status).toBe(200);
      expect(await roomRowsOf(reservation)).toEqual([
        expect.objectContaining({
          room_number: '202',
          stay_status: 'EXPECTED',
        }),
      ]);
      expect(await dailyUpdatesOf(reservation)).toEqual([
        { update_type: 'UPDATED', removal_reason: null },
      ]);
    });

    it('7: con llegada futura, cambia a la 202 sin avisar al Módulo 1', async () => {
      await listSentToday();
      const reservation = await stored();

      const { confirmed } = await api.previewAndConfirm(
        reservation.reservationRef,
        {
          updatedAt: reservation.updatedAt,
          rooms: [{ roomId: ROOM_202.id, guestCount: 2 }],
        },
      );

      expect(confirmed.status).toBe(200);
      expect(await roomRowsOf(reservation)).toEqual([
        expect.objectContaining({ room_number: '202' }),
      ]);
      expect(await dailyUpdatesOf(reservation)).toEqual([]);
    });
  });

  describe('escenarios 8 y 9: agregar y quitar', () => {
    it('8: agregar la 202 con 2 personas: queda EXPECTED con su tarifa, el total sube y, con llegada hoy, avisa UPDATED', async () => {
      await listSentToday();
      const reservation = await stored({
        startDate: TODAY,
        endDate: plusDays(TODAY, 2),
      });

      const { shown, confirmed } = await api.previewAndConfirm(
        reservation.reservationRef,
        {
          updatedAt: reservation.updatedAt,
          rooms: [
            { roomId: ROOM_201.id, guestCount: 2 },
            { roomId: ROOM_202.id, guestCount: 2 },
          ],
        },
      );

      // Solo se cotiza la nueva; el total suma la que se conserva (600000.00) y la nueva (600000.00).
      expect(shown.body.quotes).toMatchObject({
        rooms: [{ key: ROOM_202.id }],
        total: { amount: '1200000.00' },
      });
      expect(confirmed.status).toBe(200);
      expect(confirmed.body.guestCount).toBe(4);
      expect(await roomRowsOf(reservation)).toEqual([
        expect.objectContaining({ room_number: '201', amount: '600000.00' }),
        expect.objectContaining({
          room_number: '202',
          guest_count: 2,
          amount: '600000.00',
          stay_status: 'EXPECTED',
        }),
      ]);
      expect(await dailyUpdatesOf(reservation)).toEqual([
        { update_type: 'UPDATED', removal_reason: null },
      ]);
    });

    it('9: quitar la 202: se va con su tarifa y sus personas y, con llegada hoy, avisa UPDATED', async () => {
      await listSentToday();
      const reservation = await stored({
        startDate: TODAY,
        endDate: plusDays(TODAY, 2),
        rooms: [roomOf(ROOM_201, 2), roomOf(ROOM_202, 2, '700000.00')],
      });

      const { shown, confirmed } = await api.previewAndConfirm(
        reservation.reservationRef,
        {
          updatedAt: reservation.updatedAt,
          rooms: [{ roomId: ROOM_201.id, guestCount: 2 }],
        },
      );

      expect(shown.body.quotes).toBeNull();
      expect(confirmed.status).toBe(200);
      expect(confirmed.body.guestCount).toBe(2);
      expect(await roomRowsOf(reservation)).toEqual([
        expect.objectContaining({ room_number: '201', amount: '600000.00' }),
      ]);
      expect(await reservationRowOf(reservation)).toMatchObject({
        guest_count: 2,
      });
      expect(await dailyUpdatesOf(reservation)).toEqual([
        { update_type: 'UPDATED', removal_reason: null },
      ]);
    });
  });

  it('escenario 10: quitar la única habitación: 400 "La reserva debe conservar al menos una habitación." y no cambia nada', async () => {
    const reservation = await stored();
    const before = await snapshotOf(reservation);

    const { body } = await api
      .preview(reservation.reservationRef, {
        updatedAt: reservation.updatedAt,
        rooms: [],
      })
      .expect(400);

    expect(body).toMatchObject({
      errorCode: 'LAST_ROOM_CANNOT_BE_REMOVED',
      message: 'La reserva debe conservar al menos una habitación.',
    });
    expect(await snapshotOf(reservation)).toEqual(before);
  });

  it('escenario 11: solo personas: guarda sin Módulo 3 ni disponibilidad y, con llegada hoy, avisa UPDATED', async () => {
    await listSentToday();
    // Dos habitaciones de capacidad 2 y 3 personas.
    const reservation = await stored({
      startDate: TODAY,
      endDate: plusDays(TODAY, 2),
      rooms: [roomOf(ROOM_201, 2), roomOf(ROOM_203, 1)],
    });

    const { shown, confirmed } = await api.previewAndConfirm(
      reservation.reservationRef,
      {
        updatedAt: reservation.updatedAt,
        rooms: [
          { roomId: ROOM_201.id, guestCount: 2 },
          { roomId: ROOM_203.id, guestCount: 2 },
        ],
      },
    );

    expect(shown.body.quotes).toBeNull();
    expect(confirmed.status).toBe(200);
    expect(ctx.modules.quotedTypes).toEqual([]);
    expect(ctx.modules.maintenanceCalls).toBe(0);
    expect(await roomRowsOf(reservation)).toEqual([
      expect.objectContaining({ room_number: '201', guest_count: 2 }),
      expect.objectContaining({ room_number: '203', guest_count: 2 }),
    ]);
    expect(await reservationRowOf(reservation)).toMatchObject({
      guest_count: 4,
    });
    expect(await dailyUpdatesOf(reservation)).toEqual([
      { update_type: 'UPDATED', removal_reason: null },
    ]);
  });

  describe('escenario 12: capacidad', () => {
    it.each([
      [
        3,
        'GUEST_COUNT_EXCEEDS_CAPACITY',
        'La cantidad de personas supera la capacidad de la habitación.',
      ],
      [
        0,
        'GUEST_COUNT_TOO_LOW',
        'Cada habitación debe tener al menos una persona.',
      ],
    ])(
      '%i personas en una habitación de capacidad 2: 400 %s y nada se guarda',
      async (guestCount, errorCode, message) => {
        const reservation = await stored({
          rooms: [roomOf(ROOM_201, 2), roomOf(ROOM_203, 1)],
        });
        const before = await snapshotOf(reservation);
        const change = {
          updatedAt: reservation.updatedAt,
          rooms: [
            { roomId: ROOM_201.id, guestCount: 2 },
            { roomId: ROOM_203.id, guestCount },
          ],
        };

        for (const call of [api.preview, api.confirm]) {
          const { body } = await call(reservation.reservationRef, {
            ...change,
            expectedRates: [],
          }).expect(400);
          expect(body).toMatchObject({ errorCode, message });
        }
        expect(await snapshotOf(reservation)).toEqual(before);
      },
    );
  });

  describe('casos borde', () => {
    it('Módulo 3 caído al recotizar: 400 RECALCULATION_UNAVAILABLE y nada se guarda', async () => {
      const reservation = await stored();
      const before = await snapshotOf(reservation);
      ctx.modules.module3Down = true;

      const { body } = await api
        .preview(reservation.reservationRef, {
          updatedAt: reservation.updatedAt,
          endDate: plusDays(END, 1),
        })
        .expect(400);

      expect(body).toMatchObject({
        errorCode: 'RECALCULATION_UNAVAILABLE',
        message:
          'No se pudo calcular la nueva tarifa en este momento. Intente más tarde.',
      });
      expect(await snapshotOf(reservation)).toEqual(before);
    });

    it.each([
      ['la salida igual a la entrada', { startDate: START, endDate: START }],
      ['la salida antes de la entrada', { startDate: END, endDate: START }],
      ['una fecha que no existe', { endDate: '2036-02-30' }],
    ])(
      'fechas inválidas (%s): 400 INVALID_RESERVATION_DATES',
      async (_case, dates) => {
        const reservation = await stored();

        const { body } = await api
          .preview(reservation.reservationRef, {
            updatedAt: reservation.updatedAt,
            ...dates,
          })
          .expect(400);

        expect(body).toMatchObject({
          errorCode: 'INVALID_RESERVATION_DATES',
          message: 'La fecha de salida debe ser posterior a la de entrada.',
        });
      },
    );

    it('fecha de entrada pasada, con "hoy" cambiando: válida en la vista previa, rechazada al confirmar si el día ya pasó', async () => {
      const reservation = await stored();
      const tomorrow = plusDays(TODAY, 1);
      const change = { updatedAt: reservation.updatedAt, startDate: tomorrow };
      const shown = await api
        .preview(reservation.reservationRef, change)
        .expect(200);

      // Cambia el día operativo: la entrada de la vista previa ya es de ayer.
      ctx.setToday(plusDays(TODAY, 2));
      const { body } = await api
        .confirm(reservation.reservationRef, {
          ...change,
          expectedRates: (
            shown.body.quotes.rooms as {
              key: string;
              lodgingAmount: { amount: string; currency: string };
            }[]
          ).map(({ key, lodgingAmount }) => ({
            roomId: key,
            lodgingAmount: lodgingAmount.amount,
            currency: lodgingAmount.currency,
          })),
        })
        .expect(400);

      expect(body).toMatchObject({
        errorCode: 'START_DATE_IN_PAST',
        message: 'La fecha de entrada no puede ser anterior a hoy.',
      });
      expect(await reservationRowOf(reservation)).toMatchObject({
        start_date: START,
      });
    });

    it.each([
      [
        'en el titular',
        {
          guest: {
            firstName: 'Ana\u0007',
            lastName: 'Pérez',
            documentType: 'CC',
            documentNumber: '52123456',
            contactPhone: null,
            contactEmail: null,
          },
        },
      ],
      ['en las observaciones', { notes: 'Llega \u0007 tarde' }],
    ])(
      'caracteres extraños %s: 400 INVALID_CHARACTERS',
      async (_case, change) => {
        const reservation = await stored();

        const { body } = await api
          .preview(reservation.reservationRef, {
            updatedAt: reservation.updatedAt,
            ...change,
          })
          .expect(400);

        expect(body).toMatchObject({
          errorCode: 'INVALID_CHARACTERS',
          message: 'El formato de los datos contiene caracteres no válidos.',
        });
      },
    );

    it('observaciones de más de 500 caracteres: 400 NOTES_TOO_LONG; con 500, se guardan', async () => {
      const reservation = await stored();

      const { body } = await api
        .preview(reservation.reservationRef, {
          updatedAt: reservation.updatedAt,
          notes: 'a'.repeat(501),
        })
        .expect(400);
      const { confirmed } = await api.previewAndConfirm(
        reservation.reservationRef,
        { updatedAt: reservation.updatedAt, notes: 'a'.repeat(500) },
      );

      expect(body).toMatchObject({
        errorCode: 'NOTES_TOO_LONG',
        message: 'Las observaciones no pueden superar 500 caracteres.',
      });
      expect(confirmed.status).toBe(200);
    });

    it('una habitación repetida: 400 ROOM_ALREADY_IN_RESERVATION', async () => {
      const reservation = await stored();

      const { body } = await api
        .preview(reservation.reservationRef, {
          updatedAt: reservation.updatedAt,
          rooms: [
            { roomId: ROOM_201.id, guestCount: 1 },
            { roomId: ROOM_201.id, guestCount: 1 },
          ],
        })
        .expect(400);

      expect(body).toMatchObject({
        errorCode: 'ROOM_ALREADY_IN_RESERVATION',
        message: 'La habitación ya forma parte de la reserva.',
      });
    });

    it('más de 10 habitaciones: 400 INVALID_ROOM_COUNT', async () => {
      const reservation = await stored();

      const { body } = await api
        .preview(reservation.reservationRef, {
          updatedAt: reservation.updatedAt,
          rooms: ELEVEN_ROOMS.map(({ id }) => ({ roomId: id, guestCount: 1 })),
        })
        .expect(400);

      expect(body).toMatchObject({
        errorCode: 'INVALID_ROOM_COUNT',
        message: 'Una reserva debe tener entre 1 y 10 habitaciones.',
      });
    });

    it('edición simultánea: dos confirmaciones con el mismo updatedAt, una guarda y la otra recibe 400 CONCURRENT_UPDATE', async () => {
      const reservation = await stored();
      const confirmWith = (notes: string) =>
        api.confirm(reservation.reservationRef, {
          updatedAt: reservation.updatedAt,
          notes,
          expectedRates: [],
        });

      const answers = await Promise.all([
        confirmWith('Primera'),
        confirmWith('Segunda'),
      ]);

      const saved = answers.filter(({ status }) => status === 200);
      const rejected = answers.filter(({ status }) => status === 400);
      expect(saved).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].body).toMatchObject({
        errorCode: 'CONCURRENT_UPDATE',
        message: 'Esta reserva ya fue actualizada o cancelada recientemente',
      });
      expect(await reservationRowOf(reservation)).toMatchObject({
        notes: saved[0].body.notes,
      });
    });

    it('fechas que hacen entrar la reserva en la lista del día: avisa ADDED', async () => {
      await listSentToday();
      const reservation = await stored({
        startDate: plusDays(TODAY, 1),
        endDate: plusDays(TODAY, 3),
      });

      const { confirmed } = await api.previewAndConfirm(
        reservation.reservationRef,
        { updatedAt: reservation.updatedAt, startDate: TODAY },
      );

      expect(confirmed.status).toBe(200);
      expect(await dailyUpdatesOf(reservation)).toEqual([
        { update_type: 'ADDED', removal_reason: null },
      ]);
    });

    it('fechas que hacen salir la reserva de la lista del día: avisa REMOVED con motivo DATE_CHANGED', async () => {
      await listSentToday();
      const reservation = await stored({
        startDate: TODAY,
        endDate: plusDays(TODAY, 2),
      });

      const { confirmed } = await api.previewAndConfirm(
        reservation.reservationRef,
        { updatedAt: reservation.updatedAt, startDate: plusDays(TODAY, 1) },
      );

      expect(confirmed.status).toBe(200);
      expect(await dailyUpdatesOf(reservation)).toEqual([
        { update_type: 'REMOVED', removal_reason: 'DATE_CHANGED' },
      ]);
    });
  });
});
