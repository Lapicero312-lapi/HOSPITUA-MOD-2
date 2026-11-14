import { randomUUID } from 'node:crypto';
import type { QueryRunner } from 'typeorm';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import {
  PROCESS_CHECK_IN,
  type ProcessCheckIn,
} from '../../../../src/application/use-cases/update-reservation/ports/in/process-check-in.port.js';
import type { Reservation } from '../../../../src/domain/reservation/reservation.js';
import { Money } from '../../../../src/domain/shared/money.js';
import { INBOUND_QUEUES } from '../../../../src/infrastructure/config/rabbitmq.topology.js';
import { aDirectReservation, aDirectRoom } from '../../../support/builders.js';
import { ROOM_201 } from '../../../support/rooms.js';
import { truncateAllTables } from '../../support/database.js';
import {
  aGate,
  type ModificationApp,
  type ModificationHttp,
  modificationHttp,
  plusDays,
  startModificationApp,
} from '../../support/modification-app.js';

/** Un día operativo de 2036, propio de esta prueba; la reserva llega hoy, para que el Check-In sea el de su día. */
const TODAY = '2036-09-01';
const END = '2036-09-03';

const CONCURRENT_UPDATE = {
  errorCode: 'CONCURRENT_UPDATE',
  message: 'Esta reserva ya fue actualizada o cancelada recientemente',
};

/**
 * Una modificación (B2) y un Check-In sobre la misma reserva (T020 de `update-reservation`, FR-008). Los
 * dos bloquean la reserva con `SELECT … FOR UPDATE` y la modificación vuelve a comparar `updatedAt` ya
 * bloqueada: gane quien gane, el otro ve la reserva como quedó y nada queda a medias.
 *
 * Para que el orden no dependa de la suerte, la prueba retiene ella misma el bloqueo de la fila, espera a
 * que los dos estén en la fila de espera de PostgreSQL (`pg_stat_activity`) en el orden que quiere y lo
 * suelta: PostgreSQL entrega el bloqueo de una fila en el orden en que se pidió.
 */
describe('update-reservation: una modificación y un Check-In a la vez (T020)', () => {
  let ctx: ModificationApp;
  let api: ModificationHttp;
  let holder: QueryRunner | null = null;
  let sequence = 0;

  /** Una reserva directa `ACTIVE` que llega hoy, en la 201 con 2 personas. */
  const stored = () =>
    ctx.reservations.insert(
      aDirectReservation({
        startDate: TODAY,
        endDate: END,
        notes: 'Llegada tarde',
        rooms: [
          aDirectRoom({
            roomId: ROOM_201.id,
            roomNumber: '201',
            categoryRoom: 'DOBLE',
            guestCount: 2,
            rate: {
              roomGrossAmount: Money.of('600000.00', 'COP'),
              quoteId: 'Q-201',
            },
          }),
        ],
      }),
    );

  /** El Check-In de la 201 que envía el Módulo 1. */
  const checkIn = (reservation: Reservation) =>
    ctx.app.get<ProcessCheckIn>(PROCESS_CHECK_IN).execute({
      messageId: randomUUID(),
      sequenceNumber: ++sequence,
      queue: INBOUND_QUEUES.CHECK_IN.name,
      reservationRef: reservation.reservationRef,
      roomId: ROOM_201.id,
      movementDate: TODAY,
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

  /** La confirmación de un cambio de observaciones, sin nada que recotizar ni verificar. */
  const confirmNotes = (reservation: Reservation, notes: string) =>
    api
      .confirm(reservation.reservationRef, {
        updatedAt: reservation.updatedAt,
        notes,
        expectedRates: [],
      })
      .then((res) => res);

  const stateOf = async ({ id }: Reservation) => {
    const [row]: Record<string, unknown>[] = await ctx.dataSource.query(
      `SELECT r.status, r.end_date::text AS end_date, r.notes,
              rr.stay_status, rr.room_gross_amount::text AS amount
       FROM reservation r JOIN reservation_room rr ON rr.reservation_id = r.id
       WHERE r.id = $1`,
      [id],
    );
    return row;
  };

  /** La prueba bloquea la reserva, como lo haría una transacción que la tiene tomada. */
  const holdReservation = async ({ id }: Reservation) => {
    holder = ctx.dataSource.createQueryRunner();
    await holder.connect();
    await holder.startTransaction();
    await holder.query('SELECT id FROM reservation WHERE id = $1 FOR UPDATE', [
      id,
    ]);
  };
  const releaseReservation = async () => {
    await holder?.commitTransaction();
    await holder?.release();
    holder = null;
  };

  /** Espera a que haya `count` transacciones esperando un bloqueo. */
  const untilWaiting = async (count: number) => {
    for (let attempt = 0; attempt < 500; attempt++) {
      const [{ waiting }]: { waiting: number }[] = await ctx.dataSource.query(
        `SELECT count(*)::int AS waiting FROM pg_stat_activity
         WHERE datname = current_database() AND wait_event_type = 'Lock'`,
      );
      if (waiting >= count) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Nunca hubo ${count} transacciones esperando el bloqueo.`);
  };

  beforeAll(async () => {
    ctx = await startModificationApp(TODAY);
    api = modificationHttp(ctx.app);
  });

  beforeEach(async () => {
    ctx.resetModules();
    await truncateAllTables(ctx.dataSource);
  });

  afterEach(async () => {
    // Si una prueba falla con la reserva bloqueada, la suelta para no trabar a las demás.
    if (holder !== null) {
      await holder.rollbackTransaction();
      await holder.release();
      holder = null;
    }
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('el Check-In llega mientras la modificación recotiza: la modificación responde 400 CONCURRENT_UPDATE y el Check-In queda aplicado', async () => {
    const reservation = await stored();
    const change = {
      updatedAt: reservation.updatedAt,
      endDate: plusDays(END, 1),
    };
    const shown = await api
      .preview(reservation.reservationRef, change)
      .expect(200);
    const gate = aGate();
    ctx.modules.quoteGate = gate;

    const confirmation = api
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
      .then((res) => res);
    // La confirmación ya verificó y está esperando la tarifa del Módulo 3, antes de abrir su transacción.
    await gate.reached;
    expect(await checkIn(reservation)).toBe('APPLIED');
    gate.release();
    const res = await confirmation;

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject(CONCURRENT_UPDATE);
    expect(await stateOf(reservation)).toEqual({
      status: 'IN_PROGRESS',
      end_date: END,
      notes: 'Llegada tarde',
      stay_status: 'CHECKED_IN',
      amount: '600000.00',
    });
  });

  it('el Check-In toma la reserva primero: la modificación, que esperaba el bloqueo, responde 400 CONCURRENT_UPDATE', async () => {
    const reservation = await stored();
    await holdReservation(reservation);

    const checkedIn = checkIn(reservation);
    await untilWaiting(1);
    const confirmation = confirmNotes(reservation, 'Cambiada');
    await untilWaiting(2);
    await releaseReservation();

    expect(await checkedIn).toBe('APPLIED');
    const res = await confirmation;
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject(CONCURRENT_UPDATE);
    expect(await stateOf(reservation)).toEqual({
      status: 'IN_PROGRESS',
      end_date: END,
      notes: 'Llegada tarde',
      stay_status: 'CHECKED_IN',
      amount: '600000.00',
    });
  });

  it('la modificación toma la reserva primero: guarda, y el Check-In, que esperaba el bloqueo, se aplica sobre la reserva ya modificada', async () => {
    const reservation = await stored();
    await holdReservation(reservation);

    const confirmation = confirmNotes(reservation, 'Cambiada');
    await untilWaiting(1);
    const checkedIn = checkIn(reservation);
    await untilWaiting(2);
    await releaseReservation();

    const res = await confirmation;
    expect(res.status).toBe(200);
    expect(await checkedIn).toBe('APPLIED');
    expect(await stateOf(reservation)).toEqual({
      status: 'IN_PROGRESS',
      end_date: END,
      notes: 'Cambiada',
      stay_status: 'CHECKED_IN',
      amount: '600000.00',
    });
  });
});
