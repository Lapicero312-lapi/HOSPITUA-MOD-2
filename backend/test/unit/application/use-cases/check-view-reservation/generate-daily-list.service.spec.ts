import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { Clock } from '../../../../../src/application/ports/out/clock.js';
import type {
  DailyMessage,
  DailyMessageRepository,
} from '../../../../../src/application/ports/out/daily-message.repository.js';
import type {
  DailySequence,
  DailySequenceRepository,
} from '../../../../../src/application/ports/out/daily-sequence.repository.js';
import type {
  DailyListArrival,
  ReservationQueryPort,
} from '../../../../../src/application/ports/out/reservation-query.port.js';
import type {
  Transaction,
  TransactionRunner,
} from '../../../../../src/application/ports/out/transaction.js';
import { GenerateDailyListService } from '../../../../../src/application/use-cases/check-view-reservation/generate-daily-list.service.js';
import {
  aDirectReservation,
  aDirectRoom,
  aGuest,
  anOtaReservation,
  anOtaRoom,
} from '../../../../support/builders.js';

const TX = { tx: 'la de la lista' } as unknown as Transaction;
const TODAY = '2026-10-09';
/** 00:00:02 de Colombia, como `generatedAt` del ejemplo del plan. */
const NOW = new Date('2026-10-09T05:00:02.000Z');
const CLOCK: Clock = { today: () => TODAY, now: () => NOW };
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** La reserva del ejemplo de "Lista del día" del plan, guardada. */
const anaPerez = () =>
  aDirectReservation({
    reservationRef: 'RSV-3F9A1C7B',
    startDate: TODAY,
    endDate: '2026-10-12',
    rooms: [
      aDirectRoom({ roomNumber: '201', categoryRoom: 'DOBLE', guestCount: 2 }),
    ],
    guest: aGuest({
      firstName: 'Ana',
      lastName: 'Pérez',
      documentType: 'CC',
      documentNumber: '123',
      nationality: 'Colombia',
      contactPhone: '+57 300 000 0000',
      contactEmail: 'ana@correo.com',
    }),
    notes: 'Llegada tarde',
    updatedAt: '2026-10-08 15:42:10.123456-05',
  });

/** El servicio con los puertos simulados; `day` es la fila que devuelve el bloqueo. */
function serviceWith(
  arrivals: DailyListArrival[],
  day: DailySequence = { lastSequence: 0, listGenerated: false },
  insert: DailyMessageRepository['insert'] = () => Promise.resolve(),
) {
  const calls: string[] = [];
  const run = vi.fn((work: (tx: Transaction) => Promise<unknown>) => work(TX));
  const afterCommit = vi.fn<TransactionRunner['afterCommit']>();
  const publication = { execute: vi.fn(() => Promise.resolve(0)) };
  const lockOrCreateDay = vi.fn((_date: string, _tx: Transaction) => {
    calls.push('lockOrCreateDay');
    return Promise.resolve(day);
  });
  const markListGenerated = vi.fn((_date: string, _tx: Transaction) => {
    calls.push('markListGenerated');
    return Promise.resolve();
  });
  const findArrivals = vi.fn((_date: string, _tx: Transaction) => {
    calls.push('findArrivals');
    return Promise.resolve(arrivals);
  });
  const insertMessage = vi.fn((message: DailyMessage, tx: Transaction) => {
    calls.push('insert');
    return insert(message, tx);
  });
  const service = new GenerateDailyListService(
    { run, afterCommit } as unknown as TransactionRunner,
    {
      lockOrCreateDay,
      markListGenerated,
    } as unknown as DailySequenceRepository,
    { findArrivals } as unknown as ReservationQueryPort,
    { insert: insertMessage } as unknown as DailyMessageRepository,
    CLOCK,
    publication,
  );
  /** El mensaje que se guardó. */
  const saved = () => insertMessage.mock.calls[0][0];
  return {
    service,
    calls,
    run,
    lockOrCreateDay,
    markListGenerated,
    findArrivals,
    insertMessage,
    saved,
    afterCommit,
    publication,
  };
}

describe('GenerateDailyList (T023)', () => {
  it('ejemplo del plan: guarda la lista con la secuencia 1 en una sola transacción, bloqueando antes de leer', async () => {
    const reservation = anaPerez();
    const {
      service,
      calls,
      run,
      lockOrCreateDay,
      findArrivals,
      insertMessage,
      markListGenerated,
      saved,
    } = serviceWith([{ reservation, otaName: null }]);

    await expect(service.execute()).resolves.toBe(true);

    expect(run).toHaveBeenCalledOnce();
    expect(calls).toEqual([
      'lockOrCreateDay',
      'findArrivals',
      'insert',
      'markListGenerated',
    ]);
    expect(lockOrCreateDay).toHaveBeenCalledWith(TODAY, TX);
    expect(findArrivals).toHaveBeenCalledWith(TODAY, TX);
    expect(insertMessage.mock.calls[0][1]).toBe(TX);
    expect(markListGenerated).toHaveBeenCalledWith(TODAY, TX);

    const message = saved();
    expect(message).toMatchObject({
      messageId: expect.stringMatching(UUID),
      operationalDate: TODAY,
      sequenceNumber: 1,
      kind: 'LIST',
      updateType: null,
      reservationId: null,
      removalReason: null,
    });
    expect(message.payload).toEqual({
      messageId: message.messageId,
      sequenceNumber: 1,
      operationalDate: TODAY,
      generatedAt: '2026-10-09T00:00:02-05:00',
      totalReservations: 1,
      totalRooms: 1,
      totalGuests: 2,
      reservations: [
        {
          reservationRef: 'RSV-3F9A1C7B',
          status: 'ACTIVE',
          source: 'DIRECTA',
          startDate: TODAY,
          endDate: '2026-10-12',
          guestCount: 2,
          notes: 'Llegada tarde',
          updatedAt: '2026-10-08T15:42:10.123456-05:00',
          rooms: [
            {
              roomId: reservation.rooms[0].roomId,
              roomNumber: '201',
              categoryRoom: 'DOBLE',
              guestCount: 2,
            },
          ],
          guest: {
            guestRef: reservation.guest.id,
            firstName: 'Ana',
            lastName: 'Pérez',
            fullName: 'Ana Pérez',
            documentType: 'CC',
            documentNumber: '123',
            nationality: 'Colombia',
            contactPhone: '+57 300 000 0000',
            contactEmail: 'ana@correo.com',
          },
        },
      ],
    });
  });

  it('una de OTA viaja con su agencia en mayúsculas y su código de confirmación', async () => {
    const reservation = anOtaReservation(randomUUID(), {
      startDate: TODAY,
      endDate: '2026-10-11',
      updatedAt: '2026-10-08 10:00:00.5-05',
    });
    const { service, saved } = serviceWith([
      { reservation, otaName: 'Booking.com' },
    ]);

    await service.execute();

    const [projected] = (
      saved().payload as { reservations: Record<string, unknown>[] }
    ).reservations;
    expect(projected).toMatchObject({
      source: 'BOOKING',
      externalConfirmationCode: '4417829013',
      updatedAt: '2026-10-08T10:00:00.500000-05:00',
    });
  });

  it('los totales suman las habitaciones y los guestCount de todas las reservas de la lista', async () => {
    const twoRooms = aDirectReservation({
      startDate: TODAY,
      rooms: [
        aDirectRoom({ guestCount: 2 }),
        aDirectRoom({ roomNumber: '202', guestCount: 1 }),
      ],
      updatedAt: '2026-10-08 15:42:10-05',
    });
    const oneRoom = aDirectReservation({
      startDate: TODAY,
      rooms: [aDirectRoom({ roomNumber: '305', guestCount: 4 })],
      updatedAt: '2026-10-08 15:42:10-05',
    });
    const { service, saved } = serviceWith([
      { reservation: twoRooms, otaName: null },
      { reservation: oneRoom, otaName: null },
    ]);

    await service.execute();

    expect(saved().payload).toMatchObject({
      totalReservations: 2,
      totalRooms: 3,
      totalGuests: 7,
    });
  });

  it('una con una habitación sin asignar no entra a la lista ni a los totales (DailyListMembership)', async () => {
    const unassigned = anOtaReservation(randomUUID(), {
      startDate: TODAY,
      rooms: [
        anOtaRoom(),
        anOtaRoom({ roomId: null, roomNumber: null, guestCount: 3 }),
      ],
      updatedAt: '2026-10-08 15:42:10-05',
    });
    const reservation = anaPerez();
    const { service, saved } = serviceWith([
      { reservation: unassigned, otaName: 'Booking.com' },
      { reservation, otaName: null },
    ]);

    await service.execute();

    const payload = saved().payload as {
      totalReservations: number;
      totalRooms: number;
      totalGuests: number;
      reservations: { reservationRef: string }[];
    };
    expect(payload.reservations.map((r) => r.reservationRef)).toEqual([
      'RSV-3F9A1C7B',
    ]);
    expect(payload).toMatchObject({
      totalReservations: 1,
      totalRooms: 1,
      totalGuests: 2,
    });
  });

  it('las reservas van en el orden en que llegan de findArrivals (por reservationRef)', async () => {
    const first = aDirectReservation({
      reservationRef: 'RSV-00000001',
      startDate: TODAY,
      updatedAt: '2026-10-08 15:42:10-05',
    });
    const second = aDirectReservation({
      reservationRef: 'RSV-00000002',
      startDate: TODAY,
      updatedAt: '2026-10-08 15:42:10-05',
    });
    const { service, saved } = serviceWith([
      { reservation: first, otaName: null },
      { reservation: second, otaName: null },
    ]);

    await service.execute();

    const { reservations } = saved().payload as {
      reservations: { reservationRef: string }[];
    };
    expect(reservations.map((r) => r.reservationRef)).toEqual([
      'RSV-00000001',
      'RSV-00000002',
    ]);
  });

  it('sin llegadas, la lista sale igual, con reservations vacío y los tres totales en 0', async () => {
    const { service, saved, markListGenerated } = serviceWith([]);

    await expect(service.execute()).resolves.toBe(true);

    expect(saved().payload).toMatchObject({
      totalReservations: 0,
      totalRooms: 0,
      totalGuests: 0,
      reservations: [],
    });
    expect(markListGenerated).toHaveBeenCalledOnce();
  });

  it('historia 4, escenario 4: si la lista ya está generada no lee ni guarda nada y devuelve false', async () => {
    const { service, findArrivals, insertMessage, markListGenerated } =
      serviceWith([{ reservation: anaPerez(), otaName: null }], {
        lastSequence: 3,
        listGenerated: true,
      });

    await expect(service.execute()).resolves.toBe(false);

    expect(findArrivals).not.toHaveBeenCalled();
    expect(insertMessage).not.toHaveBeenCalled();
    expect(markListGenerated).not.toHaveBeenCalled();
  });

  it('con otro día operativo, lo usa en el bloqueo, la consulta, el mensaje y la marca', async () => {
    const { service, lockOrCreateDay, findArrivals, markListGenerated, saved } =
      serviceWith([]);

    await service.execute('2026-10-10');

    expect(lockOrCreateDay).toHaveBeenCalledWith('2026-10-10', TX);
    expect(findArrivals).toHaveBeenCalledWith('2026-10-10', TX);
    expect(markListGenerated).toHaveBeenCalledWith('2026-10-10', TX);
    expect(saved()).toMatchObject({ operationalDate: '2026-10-10' });
    expect(saved().payload).toMatchObject({ operationalDate: '2026-10-10' });
  });

  it('con otro día operativo, sus llegadas entran: la pertenencia se decide con ese día, no con el de hoy', async () => {
    const arrivingThatDay = aDirectReservation({
      reservationRef: 'RSV-0000000A',
      startDate: '2026-10-10',
      updatedAt: '2026-10-08 15:42:10-05',
    });
    const { service, saved } = serviceWith([
      { reservation: arrivingThatDay, otaName: null },
    ]);

    await service.execute('2026-10-10');

    const payload = saved().payload as {
      totalReservations: number;
      reservations: { reservationRef: string }[];
    };
    expect(payload.reservations.map((r) => r.reservationRef)).toEqual([
      'RSV-0000000A',
    ]);
    expect(payload.totalReservations).toBe(1);
  });

  it('una llegada de otro día que llegara de la consulta no entra: la pertenencia es por el día operativo', async () => {
    const tomorrow = aDirectReservation({
      startDate: '2026-10-10',
      updatedAt: '2026-10-08 15:42:10-05',
    });
    const { service, saved } = serviceWith([
      { reservation: tomorrow, otaName: null },
    ]);

    await service.execute();

    expect(saved().payload).toMatchObject({ reservations: [] });
  });

  it('si no se puede guardar el mensaje, no marca la lista como generada y el error sale tal cual', async () => {
    const failure = new Error('se cayó la conexión');
    const { service, markListGenerated } = serviceWith([], undefined, () =>
      Promise.reject(failure),
    );

    await expect(service.execute()).rejects.toBe(failure);
    expect(markListGenerated).not.toHaveBeenCalled();
  });

  it('cada lista lleva su propio messageId', async () => {
    const first = serviceWith([]);
    const second = serviceWith([]);

    await first.service.execute();
    await second.service.execute();

    expect(first.saved().messageId).not.toBe(second.saved().messageId);
  });

  describe('la publicación inmediata (T029)', () => {
    it('al generar la lista, la deja para cuando se confirme la transacción', async () => {
      const { service, afterCommit, publication } = serviceWith([]);

      expect(await service.execute()).toBe(true);

      expect(afterCommit).toHaveBeenCalledTimes(1);
      const [tx, work] = afterCommit.mock.calls[0];
      expect(tx).toBe(TX);
      expect(publication.execute).not.toHaveBeenCalled();
      await work();
      expect(publication.execute).toHaveBeenCalledTimes(1);
    });

    it('si la lista ya estaba generada, no deja ninguna publicación', async () => {
      const { service, afterCommit } = serviceWith([], {
        lastSequence: 1,
        listGenerated: true,
      });

      expect(await service.execute()).toBe(false);
      expect(afterCommit).not.toHaveBeenCalled();
    });
  });
});
