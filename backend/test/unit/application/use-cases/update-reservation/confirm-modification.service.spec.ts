import { describe, expect, it, vi } from 'vitest';
import type { Room } from '../../../../../src/application/integration/room.js';
import type {
  RoomQuote,
  RoomQuoteRequest,
} from '../../../../../src/application/integration/room-quote.js';
import type { Clock } from '../../../../../src/application/ports/out/clock.js';
import {
  type ReservationRepository,
  RoomOverlapError,
} from '../../../../../src/application/ports/out/reservation.repository.js';
import type {
  Transaction,
  TransactionRunner,
} from '../../../../../src/application/ports/out/transaction.js';
import type { CalculateDynamicRate } from '../../../../../src/application/use-cases/calculate-dynamic-rate/ports/in/calculate-dynamic-rate.port.js';
import type { VerifyAvailability } from '../../../../../src/application/use-cases/check-room-availability/ports/in/verify-availability.port.js';
import type { DailyListChangeRecorder } from '../../../../../src/application/use-cases/check-view-reservation/ports/in/daily-list-change-recorder.port.js';
import type {
  GetReservationDetail,
  ReservationDetail,
} from '../../../../../src/application/use-cases/check-view-reservation/ports/in/get-reservation-detail.port.js';
import type { ReservationLookup } from '../../../../../src/application/use-cases/check-view-reservation/ports/in/reservation-lookup.port.js';
import type { ConsultRoomInventory } from '../../../../../src/application/use-cases/consult-room-inventory/ports/in/consult-room-inventory.port.js';
import { ConfirmModificationService } from '../../../../../src/application/use-cases/update-reservation/confirm-modification.service.js';
import type {
  Reservation,
  ReservationProps,
} from '../../../../../src/domain/reservation/reservation.js';
import { BusinessError } from '../../../../../src/domain/shared/business-error.js';
import { Money } from '../../../../../src/domain/shared/money.js';
import {
  aDirectReservation,
  aDirectRoom,
  aGuest,
  anOtaReservation,
} from '../../../../support/builders.js';

/** El día operativo y la estadía de la reserva, lejos de hoy. */
const TODAY = '2031-03-12';
const START = '2031-03-20';
const END = '2031-03-22';
/** El `updatedAt` como lo entrega la base y como lo envía la pantalla: el mismo instante. */
const UPDATED_AT_DB = '2031-03-12 10:00:00.123456-05';
const UPDATED_AT = '2031-03-12T10:00:00.123456-05:00';

/** Las habitaciones del Módulo 1: la 201, la 202 y la 203 de `DOBLE` y la 305 de `SUITE`. */
const ROOM: Record<string, Room> = {
  r201: {
    id: '3f6c1e2a-8b4d-4c7e-9a1f-2b3c4d5e6f70',
    roomNumber: '201',
    categoryRoom: 'DOBLE',
    maxCapacity: 2,
  },
  r202: {
    id: '7a2d9c4e-1f3b-4e8a-b6c5-0d9e8f7a6b51',
    roomNumber: '202',
    categoryRoom: 'DOBLE',
    maxCapacity: 3,
  },
  r203: {
    id: '0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e',
    roomNumber: '203',
    categoryRoom: 'DOBLE',
    maxCapacity: 2,
  },
  r305: {
    id: '5e6f7a8b-9c0d-4e1f-a2b3-c4d5e6f7a8b9',
    roomNumber: '305',
    categoryRoom: 'SUITE',
    maxCapacity: 2,
  },
};
const { r201, r202, r203, r305 } = ROOM;

/** Una habitación de la reserva, con su tarifa y su `quoteId`. */
const stayIn = (room: Room, guestCount: number, amount: string) =>
  aDirectRoom({
    roomId: room.id,
    roomNumber: room.roomNumber,
    categoryRoom: room.categoryRoom,
    guestCount,
    rate: {
      roomGrossAmount: Money.of(amount, 'COP'),
      quoteId: `Q-old-${room.roomNumber}`,
    },
  });

/** La reserva directa del ejemplo: la 201 con 2 personas (500000) y la 202 con 1 (450000). */
const aReservation = (changes: Partial<ReservationProps> = {}) =>
  aDirectReservation({
    reservationRef: 'RSV-3F9A1C7B',
    startDate: START,
    endDate: END,
    rooms: [stayIn(r201, 2, '500000.00'), stayIn(r202, 1, '450000.00')],
    guest: aGuest({ nationality: 'Colombia' }),
    notes: 'Llegada tarde',
    updatedAt: UPDATED_AT_DB,
    ...changes,
  });

/** Una cotización nueva del Módulo 3 para una habitación: 600000 por la estadía. */
const quoteFor = (request: RoomQuoteRequest): RoomQuote => ({
  key: request.key,
  quoteId: `Q-new-${request.key}`,
  currency: 'COP',
  nightlyRates: [
    { date: request.startDate, rate: Money.of('300000.00', 'COP') },
  ],
  lodgingAmount: Money.of('600000.00', 'COP'),
});

const TX = {} as Transaction;
const DETAIL = { marker: 'el detalle de C3' } as unknown as ReservationDetail;

/**
 * El servicio con los puertos simulados. `unavailable`: los `roomId` que no están libres; `locked`: lo que
 * devuelve el bloqueo dentro de la transacción (por defecto, la misma reserva).
 */
function aConfirmation(
  reservation: Reservation | null = aReservation(),
  {
    unavailable = [] as string[],
    locked = reservation,
    blocking = [] as string[],
  }: {
    unavailable?: string[];
    locked?: Reservation | null;
    blocking?: string[];
  } = {},
) {
  const calls: string[] = [];
  const findByRef = vi.fn((ref: string) => {
    calls.push(`findByRef ${ref}`);
    return Promise.resolve(reservation);
  });
  const findForUpdate = vi.fn((tx: Transaction, ref: string) => {
    calls.push(`findForUpdate ${ref}`);
    return Promise.resolve(locked);
  });
  const findBlockingRooms = vi.fn<ReservationLookup['findBlockingRooms']>(
    (roomIds) =>
      Promise.resolve(
        roomIds
          .filter((roomId) => blocking.includes(roomId))
          .map((roomId) => ({ roomId, reservationRef: 'RSV-0000AAAA' })),
      ),
  );
  const byRoomId = vi.fn((roomId: string) => {
    calls.push(`byRoomId ${roomId}`);
    const room = Object.values(ROOM).find(({ id }) => id === roomId);
    return room === undefined
      ? Promise.reject(
          new BusinessError(
            'INVALID_ROOM_ID',
            'El identificador de la habitación es inválido.',
          ),
        )
      : Promise.resolve(room);
  });
  const check = vi.fn<VerifyAvailability['check']>((query) => {
    calls.push(`check ${query.roomId}`);
    const room = Object.values(ROOM).find(({ id }) => id === query.roomId);
    if (room === undefined) {
      throw new Error('habitación desconocida');
    }
    const free = !unavailable.includes(room.id);
    return Promise.resolve({
      startDate: query.startDate,
      endDate: query.endDate,
      rooms: [
        {
          room,
          available: free,
          reason: free ? null : ('RESERVED' as const),
          maintenance: [],
        },
      ],
    });
  });
  const verifyQuotes = vi.fn<CalculateDynamicRate['verifyQuotes']>(
    (_seen, requests) => {
      calls.push(`verifyQuotes ${requests.map(({ key }) => key).join(',')}`);
      return Promise.resolve(requests.map(quoteFor));
    },
  );
  const run = vi.fn(<T>(work: (tx: Transaction) => Promise<T>) => {
    calls.push('BEGIN');
    return work(TX).then((result) => {
      calls.push('COMMIT');
      return result;
    });
  });
  const update = vi.fn<ReservationRepository['update']>((saved) => {
    calls.push('update');
    return Promise.resolve(saved);
  });
  const record = vi.fn<DailyListChangeRecorder['record']>(() => {
    calls.push('record');
    return Promise.resolve();
  });
  const execute = vi.fn((ref: string) => {
    calls.push(`detail ${ref}`);
    return Promise.resolve(DETAIL);
  });
  const clock: Clock = {
    today: () => TODAY,
    now: () => new Date('2031-03-12T15:00:00.000Z'),
  };
  const service = new ConfirmModificationService(
    {
      findByRef,
      findForUpdate,
      findBlockingRooms,
    } as unknown as ReservationLookup,
    { byRoomId } as unknown as ConsultRoomInventory,
    { check } as VerifyAvailability,
    { verifyQuotes } as unknown as CalculateDynamicRate,
    clock,
    5,
    { run } as unknown as TransactionRunner,
    { update } as unknown as ReservationRepository,
    { record } as DailyListChangeRecorder,
    { execute } as GetReservationDetail,
  );
  return {
    service,
    calls,
    findForUpdate,
    findBlockingRooms,
    verifyQuotes,
    run,
    update,
    record,
    execute,
  };
}

/** El error de negocio que lanza la confirmación. */
async function errorOf(promise: Promise<unknown>): Promise<BusinessError> {
  const error: unknown = await promise.then(
    () => {
      throw new Error('No lanzó ningún error');
    },
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(BusinessError);
  return error as BusinessError;
}

const codeOf = async (promise: Promise<unknown>) =>
  (await errorOf(promise)).errorCode;

/** El cuerpo de cambio con el `updatedAt` que leyó la pantalla. */
const change = (changes: Record<string, unknown> = {}) => ({
  updatedAt: UPDATED_AT,
  ...changes,
});

/** La lista de habitaciones del cuerpo de cambio. */
const rooms = (...entries: [Room, number][]) =>
  entries.map(([room, guestCount]) => ({ roomId: room.id, guestCount }));

/** La tarifa que vio el solicitante de una habitación recotizada. */
const seen = (room: Room, lodgingAmount = '600000.00', currency = 'COP') => ({
  roomId: room.id,
  lodgingAmount,
  currency,
});

/** La reserva que recibió `update`. */
const savedOf = (update: ReturnType<typeof aConfirmation>['update']) => {
  const [[saved]] = update.mock.calls;
  return saved;
};

/** Cada habitación guardada: número, personas, monto, `quoteId` y `stayStatus`. */
const roomsOf = (saved: Reservation) =>
  saved.rooms.map((room) => [
    room.roomNumber,
    room.guestCount,
    room.rate?.roomGrossAmount.amountWithCents,
    room.rate?.quoteId,
    room.stayStatus,
  ]);

describe('ConfirmModificationService (plan de update-reservation, B2, D2 y regla 9; T010, T011 y T012)', () => {
  describe('paso 1: la forma de expectedRates, antes de consultar nada', () => {
    it.each<[string, unknown]>([
      ['no es una lista', { roomId: r305.id }],
      ['un monto sin decimales', [seen(r305, '600000')]],
      ['un monto en cero', [seen(r305, '0.00')]],
      ['una moneda en minúsculas', [seen(r305, '600000.00', 'cop')]],
      ['sin moneda', [{ roomId: r305.id, lodgingAmount: '600000.00' }]],
      [
        'un roomId que no es texto',
        [{ roomId: 305, lodgingAmount: '600000.00', currency: 'COP' }],
      ],
      ['un elemento que no es un objeto', ['600000.00']],
    ])(
      '%s: RATE_CHANGED sin buscar la reserva',
      async (_case, expectedRates) => {
        const { service, calls } = aConfirmation();

        expect(
          await codeOf(
            service.execute('RSV-3F9A1C7B', change({ expectedRates })),
          ),
        ).toBe('RATE_CHANGED');
        expect(calls).toEqual([]);
      },
    );

    it('la forma del cambio va antes que la de expectedRates', async () => {
      const { service } = aConfirmation();

      expect(
        await codeOf(
          service.execute(
            'RSV-3F9A1C7B',
            change({ startDate: 20310320, expectedRates: 'mal' }),
          ),
        ),
      ).toBe('INVALID_RESERVATION_DATES');
    });
  });

  describe('pasos 2 a 8: los mismos de la vista previa, sin cotizar ni guardar', () => {
    it.each<[string, Reservation | null, string]>([
      ['la reserva no existe', null, 'RESERVATION_NOT_FOUND'],
      [
        'es de Booking',
        anOtaReservation('ota-1', { updatedAt: UPDATED_AT_DB }),
        'OTA_RESERVATION_READ_ONLY',
      ],
      [
        'está en curso',
        aReservation({ status: 'IN_PROGRESS' }),
        'STATUS_NOT_EDITABLE',
      ],
    ])('%s: %s', async (_case, reservation, code) => {
      const { service, verifyQuotes, run } = aConfirmation(reservation);

      expect(await codeOf(service.execute('RSV-3F9A1C7B', change()))).toBe(
        code,
      );
      expect(verifyQuotes).not.toHaveBeenCalled();
      expect(run).not.toHaveBeenCalled();
    });

    it('otro updatedAt: CONCURRENT_UPDATE antes de la transacción', async () => {
      const { service, run } = aConfirmation();

      expect(
        await codeOf(
          service.execute(
            'RSV-3F9A1C7B',
            change({ updatedAt: '2031-03-12T10:00:00.999999-05:00' }),
          ),
        ),
      ).toBe('CONCURRENT_UPDATE');
      expect(run).not.toHaveBeenCalled();
    });

    it('una habitación no disponible: ROOM_NOT_AVAILABLE con su número, sin cotizar ni guardar', async () => {
      const { service, verifyQuotes, run } = aConfirmation(aReservation(), {
        unavailable: [r305.id],
      });

      const error = await errorOf(
        service.execute(
          'RSV-3F9A1C7B',
          change({
            rooms: rooms([r201, 2], [r305, 1]),
            expectedRates: [seen(r305)],
          }),
        ),
      );

      expect(error.errorCode).toBe('ROOM_NOT_AVAILABLE');
      expect(error.message).toBe(
        'La habitación 305 no está disponible para el rango de fechas solicitado.',
      );
      expect(verifyQuotes).not.toHaveBeenCalled();
      expect(run).not.toHaveBeenCalled();
    });
  });

  describe('paso 9: verifyQuotes con lo que vio el solicitante', () => {
    it('vuelve a cotizar solo lo que dicta roomsNeedingQuote, con la tarifa vista por roomId y en RECALCULATION', async () => {
      const { service, verifyQuotes } = aConfirmation();

      await service.execute(
        'RSV-3F9A1C7B',
        change({
          rooms: rooms([r201, 2], [r305, 1]),
          expectedRates: [
            { ...seen(r305), roomId: r305.id.toUpperCase() },
            seen(r201, '1.00', 'USD'),
          ],
        }),
      );

      expect(verifyQuotes).toHaveBeenCalledTimes(1);
      const [[seenRates, requests, context]] = verifyQuotes.mock.calls;
      // El roomId en mayúsculas queda en minúsculas, como la key de la cotización.
      expect(
        seenRates.map(({ key, lodgingAmount }) => [
          key,
          lodgingAmount.amountWithCents,
          lodgingAmount.currency,
        ]),
      ).toEqual([
        [r305.id, '600000.00', 'COP'],
        [r201.id, '1.00', 'USD'],
      ]);
      expect(requests).toEqual([
        {
          key: r305.id,
          categoryRoom: 'SUITE',
          startDate: START,
          endDate: END,
        },
      ]);
      expect(context).toBe('RECALCULATION');
    });

    it('sin nada que recotizar no llama al Módulo 3, aunque vengan tarifas', async () => {
      const { service, verifyQuotes, update } = aConfirmation();

      await service.execute(
        'RSV-3F9A1C7B',
        change({ notes: 'Llega a las 11 p. m.', expectedRates: [seen(r201)] }),
      );

      expect(verifyQuotes).not.toHaveBeenCalled();
      expect(update).toHaveBeenCalledTimes(1);
    });

    it('si la tarifa cambió, RATE_CHANGED y no abre la transacción', async () => {
      const { service, verifyQuotes, run } = aConfirmation();
      verifyQuotes.mockRejectedValueOnce(
        new BusinessError(
          'RATE_CHANGED',
          'La tarifa cambió, vuelva a cotizar.',
        ),
      );

      expect(
        await codeOf(
          service.execute(
            'RSV-3F9A1C7B',
            change({ startDate: '2031-03-21', endDate: '2031-03-23' }),
          ),
        ),
      ).toBe('RATE_CHANGED');
      expect(run).not.toHaveBeenCalled();
    });
  });

  describe('sin cambios no se guarda', () => {
    it.each<[string, Record<string, unknown>]>([
      ['sin campos', {}],
      [
        'con los mismos datos',
        {
          startDate: START,
          endDate: END,
          rooms: rooms([r201, 2], [r202, 1]),
          notes: 'Llegada tarde',
        },
      ],
    ])(
      '%s: responde el detalle sin abrir la transacción ni avisar',
      async (_case, fields) => {
        const { service, run, update, record, execute } = aConfirmation();

        const detail = await service.execute('RSV-3F9A1C7B', change(fields));

        expect(detail).toBe(DETAIL);
        expect(execute).toHaveBeenCalledWith('RSV-3F9A1C7B');
        expect(run).not.toHaveBeenCalled();
        expect(update).not.toHaveBeenCalled();
        expect(record).not.toHaveBeenCalled();
      },
    );

    it('cambiar solo las personas de una habitación sí guarda', async () => {
      const { service, update } = aConfirmation();

      await service.execute(
        'RSV-3F9A1C7B',
        change({ rooms: rooms([r201, 1], [r202, 1]) }),
      );

      expect(update).toHaveBeenCalledTimes(1);
    });
  });

  describe('paso 10: la reserva que queda (T011)', () => {
    it('una cambiada de la misma categoría hereda la tarifa y el quoteId de la quitada, sin llamar al Módulo 3', async () => {
      const before = aReservation();
      const { service, verifyQuotes, update } = aConfirmation(before);

      await service.execute(
        'RSV-3F9A1C7B',
        change({ rooms: rooms([r201, 2], [r203, 1]) }),
      );

      expect(verifyQuotes).not.toHaveBeenCalled();
      const saved = savedOf(update);
      expect(roomsOf(saved)).toEqual([
        ['201', 2, '500000.00', 'Q-old-201', 'EXPECTED'],
        ['203', 1, '450000.00', 'Q-old-202', 'EXPECTED'],
      ]);
      // La 203 es una fila nueva; la 201 conserva la suya.
      expect(saved.rooms[0].id).toBe(before.rooms[0].id);
      expect(
        [before.rooms[0].id, before.rooms[1].id].includes(saved.rooms[1].id),
      ).toBe(false);
    });

    it('una cambiada de categoría se cotiza: solo ella toma la tarifa nueva, y la conservada guarda la suya', async () => {
      const { service, verifyQuotes, update } = aConfirmation();

      await service.execute(
        'RSV-3F9A1C7B',
        change({
          rooms: rooms([r201, 2], [r305, 1]),
          expectedRates: [seen(r305)],
        }),
      );

      expect(verifyQuotes.mock.calls[0][1].map(({ key }) => key)).toEqual([
        r305.id,
      ]);
      expect(roomsOf(savedOf(update))).toEqual([
        ['201', 2, '500000.00', 'Q-old-201', 'EXPECTED'],
        ['305', 1, '600000.00', `Q-new-${r305.id}`, 'EXPECTED'],
      ]);
    });

    it('con fechas nuevas se recotizan todas, también las conservadas, y ninguna hereda', async () => {
      const before = aReservation();
      const { service, update } = aConfirmation(before);

      await service.execute(
        'RSV-3F9A1C7B',
        change({
          startDate: '2031-03-21',
          endDate: '2031-03-24',
          rooms: rooms([r201, 2], [r203, 1]),
          expectedRates: [seen(r201), seen(r203)],
        }),
      );

      const saved = savedOf(update);
      expect([saved.startDate, saved.endDate]).toEqual([
        '2031-03-21',
        '2031-03-24',
      ]);
      expect(roomsOf(saved)).toEqual([
        ['201', 2, '600000.00', `Q-new-${r201.id}`, 'EXPECTED'],
        ['203', 1, '600000.00', `Q-new-${r203.id}`, 'EXPECTED'],
      ]);
      expect(saved.rooms[0].id).toBe(before.rooms[0].id);
    });

    it('agregar una la suma con su cotización, en EXPECTED; quitar otra la saca con su tarifa; la suma de personas cambia', async () => {
      const { service, update } = aConfirmation();

      await service.execute(
        'RSV-3F9A1C7B',
        change({
          rooms: rooms([r202, 3], [r305, 2]),
          expectedRates: [seen(r305)],
        }),
      );

      const saved = savedOf(update);
      // La 201 se cambia por la 305 (otra categoría) y la 202 se conserva con 3 personas.
      expect(roomsOf(saved)).toEqual([
        ['202', 3, '450000.00', 'Q-old-202', 'EXPECTED'],
        ['305', 2, '600000.00', `Q-new-${r305.id}`, 'EXPECTED'],
      ]);
      expect(saved.guestCount).toBe(5);
    });

    it('una conservada guarda su fila, su número y su stayStatus, con las personas nuevas', async () => {
      const reservation = aReservation({ status: 'PENDING' });
      const { service, update } = aConfirmation(reservation);

      await service.execute(
        'RSV-3F9A1C7B',
        change({ rooms: rooms([r201, 1], [r202, 3]) }),
      );

      const saved = savedOf(update);
      expect(saved.rooms.map(({ id }) => id)).toEqual(
        reservation.rooms.map(({ id }) => id),
      );
      expect(roomsOf(saved)).toEqual([
        ['201', 1, '500000.00', 'Q-old-201', 'EXPECTED'],
        ['202', 3, '450000.00', 'Q-old-202', 'EXPECTED'],
      ]);
    });

    it('el titular corregido guarda su id y su nacionalidad; notes en null se borran', async () => {
      const reservation = aReservation();
      const { service, update } = aConfirmation(reservation);
      const corrected = {
        firstName: 'Ana',
        lastName: 'Pérez',
        documentType: 'CE',
        documentNumber: 'X123',
        contactPhone: '+57 310 000 0000',
        contactEmail: 'ana@correo.com',
      };

      await service.execute(
        'RSV-3F9A1C7B',
        change({ guest: corrected, notes: null }),
      );

      const saved = savedOf(update);
      expect(saved.guest.snapshot()).toEqual({
        ...corrected,
        id: reservation.guest.id,
        nationality: 'Colombia',
      });
      expect(saved.notes).toBeNull();
    });

    it('sin titular ni notes en el cuerpo, quedan los de la reserva', async () => {
      const reservation = aReservation();
      const { service, update } = aConfirmation(reservation);

      await service.execute(
        'RSV-3F9A1C7B',
        change({ rooms: rooms([r201, 1], [r202, 1]) }),
      );

      const saved = savedOf(update);
      expect(saved.guest.snapshot()).toEqual(reservation.guest.snapshot());
      expect(saved.notes).toBe('Llegada tarde');
    });
  });

  describe('paso 11: la transacción (T010 y T012)', () => {
    it('en orden: verifica, cotiza, BEGIN, bloquea, guarda, avisa, COMMIT y lee el detalle', async () => {
      const { service, calls } = aConfirmation();

      await service.execute(
        'RSV-3F9A1C7B',
        change({
          rooms: rooms([r201, 2], [r305, 1]),
          expectedRates: [seen(r305)],
        }),
      );

      expect(calls.slice(calls.indexOf(`check ${r305.id}`))).toEqual([
        `check ${r305.id}`,
        `verifyQuotes ${r305.id}`,
        'BEGIN',
        'findForUpdate RSV-3F9A1C7B',
        'update',
        'record',
        'COMMIT',
        'detail RSV-3F9A1C7B',
      ]);
    });

    it('avisa a la lista del día con la reserva bloqueada y la guardada, en la misma transacción, y responde el detalle', async () => {
      const reservation = aReservation();
      const { service, findForUpdate, update, record } =
        aConfirmation(reservation);

      const detail = await service.execute(
        'RSV-3F9A1C7B',
        change({ notes: 'Llega a las 11 p. m.' }),
      );

      expect(findForUpdate).toHaveBeenCalledWith(TX, 'RSV-3F9A1C7B');
      expect(update).toHaveBeenCalledWith(expect.anything(), TX);
      const saved = savedOf(update);
      expect(record).toHaveBeenCalledWith(TX, reservation, saved);
      expect(detail).toBe(DETAIL);
    });

    it('se arma sobre la reserva bloqueada, no sobre la que se leyó antes', async () => {
      const read = aReservation();
      // La misma fila (mismas habitaciones y titular), leída otra vez dentro de la transacción.
      const locked = aDirectReservation({
        ...read.snapshot(),
        notes: 'Otra lectura',
        guest: aGuest({ ...read.guest.snapshot() }),
      });
      const { service, update } = aConfirmation(read, { locked });

      await service.execute(
        'RSV-3F9A1C7B',
        change({ rooms: rooms([r201, 1], [r202, 1]) }),
      );

      expect(savedOf(update).notes).toBe('Otra lectura');
      expect(savedOf(update).guest).toBe(locked.guest);
    });

    it('si dentro de la transacción el updatedAt ya cambió: CONCURRENT_UPDATE sin guardar ni avisar', async () => {
      const locked = aReservation({
        updatedAt: '2031-03-12 10:05:00.000001-05',
      });
      const { service, update, record } = aConfirmation(aReservation(), {
        locked,
      });

      expect(
        await codeOf(
          service.execute('RSV-3F9A1C7B', change({ notes: 'Otra' })),
        ),
      ).toBe('CONCURRENT_UPDATE');
      expect(update).not.toHaveBeenCalled();
      expect(record).not.toHaveBeenCalled();
    });

    it('si la reserva ya no está al bloquearla: RESERVATION_NOT_FOUND', async () => {
      const { service, update } = aConfirmation(aReservation(), {
        locked: null,
      });

      expect(
        await codeOf(
          service.execute('RSV-3F9A1C7B', change({ notes: 'Otra' })),
        ),
      ).toBe('RESERVATION_NOT_FOUND');
      expect(update).not.toHaveBeenCalled();
    });

    it('un error del aviso revierte la transacción: no se lee el detalle', async () => {
      const { service, record, execute } = aConfirmation();
      record.mockRejectedValueOnce(new Error('se cayó la base'));

      await expect(
        service.execute('RSV-3F9A1C7B', change({ notes: 'Otra' })),
      ).rejects.toThrow('se cayó la base');
      expect(execute).not.toHaveBeenCalled();
    });
  });

  describe('la restricción anti-solape (T012)', () => {
    const swapToBoth = () =>
      change({
        startDate: '2031-03-21',
        endDate: '2031-03-24',
        rooms: rooms([r203, 1], [r305, 1]),
        expectedRates: [seen(r203), seen(r305)],
      });

    it('ROOM_NOT_AVAILABLE con la primera verificada que ahora ocupa otra reserva', async () => {
      const { service, update, findBlockingRooms, record, execute } =
        aConfirmation(aReservation(), { blocking: [r305.id] });
      update.mockRejectedValueOnce(new RoomOverlapError());

      const error = await errorOf(
        service.execute('RSV-3F9A1C7B', swapToBoth()),
      );

      expect(error.errorCode).toBe('ROOM_NOT_AVAILABLE');
      expect(error.message).toBe(
        'La habitación 305 no está disponible para el rango de fechas solicitado.',
      );
      expect(findBlockingRooms).toHaveBeenCalledWith(
        [r203.id, r305.id],
        '2031-03-21',
        '2031-03-24',
        'RSV-3F9A1C7B',
      );
      expect(record).not.toHaveBeenCalled();
      expect(execute).not.toHaveBeenCalled();
    });

    it('si varias la ocupan, la primera en el orden de la solicitud', async () => {
      const { service, update } = aConfirmation(aReservation(), {
        blocking: [r305.id, r203.id],
      });
      update.mockRejectedValueOnce(new RoomOverlapError());

      const error = await errorOf(
        service.execute('RSV-3F9A1C7B', swapToBoth()),
      );

      expect(error.message).toBe(
        'La habitación 203 no está disponible para el rango de fechas solicitado.',
      );
    });

    it('si ya no la ocupa ninguna, nombra la primera verificada', async () => {
      const { service, update } = aConfirmation();
      update.mockRejectedValueOnce(new RoomOverlapError());

      const error = await errorOf(
        service.execute('RSV-3F9A1C7B', swapToBoth()),
      );

      expect(error.errorCode).toBe('ROOM_NOT_AVAILABLE');
      expect(error.message).toBe(
        'La habitación 203 no está disponible para el rango de fechas solicitado.',
      );
    });

    it('otro error de update sale tal cual', async () => {
      const { service, update, findBlockingRooms } = aConfirmation();
      update.mockRejectedValueOnce(
        new BusinessError(
          'CONCURRENT_UPDATE',
          'Esta reserva ya fue actualizada o cancelada recientemente',
        ),
      );

      expect(await codeOf(service.execute('RSV-3F9A1C7B', swapToBoth()))).toBe(
        'CONCURRENT_UPDATE',
      );
      expect(findBlockingRooms).not.toHaveBeenCalled();
    });
  });
});
