import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  DuplicateIdempotencyKeyError,
  type IdempotencyKeyRepository,
  type StoredIdempotencyKey,
} from '../../../../../src/application/ports/out/idempotency-key.repository.js';
import type { RoomQuote } from '../../../../../src/application/integration/room-quote.js';
import type { Clock } from '../../../../../src/application/ports/out/clock.js';
import {
  DuplicateReservationRefError,
  type ReservationRepository,
} from '../../../../../src/application/ports/out/reservation.repository.js';
import type {
  Transaction,
  TransactionRunner,
} from '../../../../../src/application/ports/out/transaction.js';
import type { CalculateDynamicRate } from '../../../../../src/application/use-cases/calculate-dynamic-rate/ports/in/calculate-dynamic-rate.port.js';
import type {
  AvailabilityResult,
  VerifyAvailability,
} from '../../../../../src/application/use-cases/check-room-availability/ports/in/verify-availability.port.js';
import type {
  GetReservationDetail,
  ReservationDetail,
} from '../../../../../src/application/use-cases/check-view-reservation/ports/in/get-reservation-detail.port.js';
import type { DailyListChangeRecorder } from '../../../../../src/application/use-cases/check-view-reservation/ports/in/daily-list-change-recorder.port.js';
import type { AriChangeRecorder } from '../../../../../src/application/use-cases/configure-ota/ports/in/ari-change-recorder.port.js';
import { CreateDirectReservationService } from '../../../../../src/application/use-cases/generate-direct-reservation/create-direct-reservation.service.js';
import type { Reservation } from '../../../../../src/domain/reservation/reservation.js';
import { BusinessError } from '../../../../../src/domain/shared/business-error.js';
import { Money } from '../../../../../src/domain/shared/money.js';
import { aRoomAvailability } from '../../../../support/room-availability.js';
import { ROOM_201, ROOM_202 } from '../../../../support/rooms.js';

/** El día operativo del ejemplo del plan. */
const TODAY = '2026-10-09';
/** El instante de las pruebas: las claves vencen a las 24 horas de él. */
const NOW = new Date('2026-10-09T15:00:00.000Z');
const KEY = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const TX = { tx: 'la de la creación' } as unknown as Transaction;

/** La solicitud del ejemplo de B. */
const REQUEST = {
  startDate: '2026-10-12',
  endDate: '2026-10-15',
  categoryRoom: 'DOBLE',
  rooms: [{ guestCount: 2 }, { guestCount: 2 }],
  guest: {
    firstName: 'Valentina',
    lastName: 'Ospina',
    documentType: 'CC',
    documentNumber: '1144093552',
    nationality: 'Colombia',
    contactPhone: '+57 300 000 0000',
    contactEmail: 'valentina@correo.com',
  },
  notes: 'Llegada después de las 8 p. m.',
  expectedRates: [
    { position: 1, lodgingAmount: '750000.00', currency: 'COP' },
    { position: 2, lodgingAmount: '750000.00', currency: 'COP' },
  ],
};

const BOTH_FREE: AvailabilityResult = {
  startDate: '2026-10-12',
  endDate: '2026-10-15',
  rooms: [aRoomAvailability(ROOM_201), aRoomAvailability(ROOM_202)],
};

function aQuote(key: string, amount = '750000.00'): RoomQuote {
  return {
    key,
    quoteId: `quote-nueva-${key}`,
    currency: 'COP',
    nightlyRates: [],
    lodgingAmount: Money.of(amount, 'COP'),
  };
}

/**
 * El servicio con los puertos simulados. `insert` devuelve la reserva que recibe; `calls` guarda el orden
 * de las llamadas a los otros módulos y a la base.
 */
function aService(
  options: {
    availability?: AvailabilityResult;
    insert?: ReservationRepository['insert'];
    recordDailyList?: DailyListChangeRecorder['record'];
    /** Las claves ya guardadas, por clave. */
    storedKeys?: Map<string, StoredIdempotencyKey>;
    saveKey?: IdempotencyKeyRepository['save'];
  } = {},
) {
  const calls: string[] = [];
  const clock: Clock = { today: () => TODAY, now: () => NOW };
  const check = vi.fn<VerifyAvailability['check']>(() => {
    calls.push('check');
    return Promise.resolve(options.availability ?? BOTH_FREE);
  });
  const verifyQuotes = vi.fn<CalculateDynamicRate['verifyQuotes']>(
    (_seen, requests) => {
      calls.push('verifyQuotes');
      return Promise.resolve(requests.map(({ key }) => aQuote(key)));
    },
  );
  const quoteRooms = vi.fn<CalculateDynamicRate['quoteRooms']>();
  const run = vi.fn((work: (tx: Transaction) => Promise<unknown>) => {
    calls.push('BEGIN');
    return work(TX).then((result) => {
      calls.push('COMMIT');
      return result;
    });
  });
  const insert = vi.fn<ReservationRepository['insert']>(
    options.insert ??
      ((reservation) => {
        calls.push('insert');
        return Promise.resolve(reservation);
      }),
  );
  const detailOf = vi.fn<GetReservationDetail['execute']>((ref) => {
    calls.push(`detail ${ref}`);
    return Promise.resolve({
      reservationRef: ref,
    } as unknown as ReservationDetail);
  });
  const recordDailyList = vi.fn<DailyListChangeRecorder['record']>(
    options.recordDailyList ??
      (() => {
        calls.push('dailyList');
        return Promise.resolve();
      }),
  );
  const recordAvailability = vi.fn<AriChangeRecorder['record']>(() => {
    calls.push('ari');
    return Promise.resolve();
  });
  const storedKeys =
    options.storedKeys ?? new Map<string, StoredIdempotencyKey>();
  const findKey = vi.fn<IdempotencyKeyRepository['find']>((key) =>
    Promise.resolve(storedKeys.get(key) ?? null),
  );
  const saveKey = vi.fn<IdempotencyKeyRepository['save']>(
    options.saveKey ??
      ((_tx, entry) => {
        calls.push('saveKey');
        storedKeys.set(entry.key, {
          requestHash: entry.requestHash,
          reservationRef: 'RSV-DE5A11ED',
          createdAt: NOW,
        });
        return Promise.resolve();
      }),
  );
  const real = new CreateDirectReservationService(
    clock,
    { check },
    { quoteRooms, verifyQuotes },
    { run } as unknown as TransactionRunner,
    { insert } as unknown as ReservationRepository,
    { execute: detailOf },
    { record: recordDailyList },
    { record: recordAvailability },
    { find: findKey, save: saveKey, deleteExpired: vi.fn() },
  );
  // Las pruebas de la creación mandan siempre una clave nueva, como la pantalla.
  const service = {
    execute: (body: unknown) => real.execute(body, randomUUID()),
  };
  return {
    service,
    real,
    findKey,
    saveKey,
    storedKeys,
    calls,
    check,
    verifyQuotes,
    quoteRooms,
    insert,
    detailOf,
    recordDailyList,
    recordAvailability,
  };
}

const errorOf = async (work: Promise<unknown>) => {
  const error = await work.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(BusinessError);
  return (error as BusinessError).errorCode;
};

/** La reserva que recibió `insert` en su llamada `n` (desde 0). */
const inserted = (insert: ReturnType<typeof aService>['insert'], n = 0) =>
  insert.mock.calls[n][0] as Reservation;

describe('CreateDirectReservation (plan de generate-direct-reservation, B, D2 y punto 12; T008)', () => {
  it('con el ejemplo de B: verifica, recotiza, guarda en una transacción y devuelve el detalle de C3', async () => {
    const { service, calls, insert, detailOf } = aService();

    const detail = await service.execute(REQUEST);

    const reservation = inserted(insert);
    expect(calls).toEqual([
      'check',
      'verifyQuotes',
      'BEGIN',
      'insert',
      'dailyList',
      'ari',
      'saveKey',
      'COMMIT',
      `detail ${reservation.reservationRef}`,
    ]);
    expect(detailOf).toHaveBeenCalledExactlyOnceWith(
      reservation.reservationRef,
    );
    expect(detail).toEqual({ reservationRef: reservation.reservationRef });
    expect(insert).toHaveBeenCalledWith(reservation, TX);
  });

  it('la reserva nace ACTIVE, DIRECT, sin agencia y con cada habitación EXPECTED, su número y su cotización nueva', async () => {
    const { service, insert } = aService();

    await service.execute(REQUEST);

    const reservation = inserted(insert);
    expect(reservation.reservationRef).toMatch(/^RSV-[0-9A-F]{8}$/);
    expect(reservation.status).toBe('ACTIVE');
    expect(reservation.source).toBe('DIRECT');
    expect(reservation.ota).toBeNull();
    expect(reservation.startDate).toBe('2026-10-12');
    expect(reservation.endDate).toBe('2026-10-15');
    expect(reservation.notes).toBe('Llegada después de las 8 p. m.');
    expect(
      reservation.rooms.map((room) => ({
        roomId: room.roomId,
        roomNumber: room.roomNumber,
        categoryRoom: room.categoryRoom,
        guestCount: room.guestCount,
        stayStatus: room.stayStatus,
        quoteId: room.rate?.quoteId,
        amount: room.rate?.roomGrossAmount.amountWithCents,
      })),
    ).toEqual([
      {
        roomId: ROOM_201.id,
        roomNumber: '201',
        categoryRoom: 'DOBLE',
        guestCount: 2,
        stayStatus: 'EXPECTED',
        quoteId: 'quote-nueva-1',
        amount: '750000.00',
      },
      {
        roomId: ROOM_202.id,
        roomNumber: '202',
        categoryRoom: 'DOBLE',
        guestCount: 2,
        stayStatus: 'EXPECTED',
        quoteId: 'quote-nueva-2',
        amount: '750000.00',
      },
    ]);
  });

  it('el titular es nuevo, propio de la reserva, con los datos de la solicitud', async () => {
    const { service, insert } = aService();

    await service.execute(REQUEST);

    const { guest } = inserted(insert);
    expect(guest.id).toMatch(/^[0-9a-f-]{36}$/);
    expect({
      firstName: guest.firstName,
      lastName: guest.lastName,
      documentType: guest.documentType,
      documentNumber: guest.documentNumber,
      nationality: guest.nationality,
      contactPhone: guest.contactPhone,
      contactEmail: guest.contactEmail,
    }).toEqual(REQUEST.guest);
  });

  it('recotiza con una solicitud por habitación y compara, por posición, el valor y la moneda que vio el solicitante', async () => {
    const { service, verifyQuotes } = aService();

    await service.execute({
      ...REQUEST,
      expectedRates: [
        { position: 2, lodgingAmount: '700000.00', currency: 'COP' },
        { position: 1, lodgingAmount: '750000.00', currency: 'USD' },
      ],
    });

    const [seen, requests, context] = verifyQuotes.mock.calls[0];
    expect(
      seen.map(({ key, lodgingAmount }) => [
        key,
        lodgingAmount.amountWithCents,
        lodgingAmount.currency,
      ]),
    ).toEqual([
      ['2', '700000.00', 'COP'],
      ['1', '750000.00', 'USD'],
    ]);
    expect(requests).toEqual([
      {
        key: '1',
        categoryRoom: 'DOBLE',
        startDate: '2026-10-12',
        endDate: '2026-10-15',
      },
      {
        key: '2',
        categoryRoom: 'DOBLE',
        startDate: '2026-10-12',
        endDate: '2026-10-15',
      },
    ]);
    expect(context).toBe('NEW_RESERVATION');
  });

  it('guarda las cotizaciones nuevas, nunca el monto que envió el cliente', async () => {
    const { service, verifyQuotes, insert } = aService();
    verifyQuotes.mockImplementation((_seen, requests) =>
      Promise.resolve(requests.map(({ key }) => aQuote(key, '760000.00'))),
    );

    await service.execute(REQUEST);

    expect(
      inserted(insert).rooms.map(
        (room) => room.rate?.roomGrossAmount.amountWithCents,
      ),
    ).toEqual(['760000.00', '760000.00']);
  });

  it('la verificación de disponibilidad es una consulta nueva de la categoría y las fechas (regla 9)', async () => {
    const { service, check, quoteRooms } = aService();

    await service.execute(REQUEST);

    expect(check).toHaveBeenCalledExactlyOnceWith({
      startDate: '2026-10-12',
      endDate: '2026-10-15',
      categoryRoom: 'DOBLE',
    });
    // La creación no usa `quoteRooms`: compara con `verifyQuotes`.
    expect(quoteRooms).not.toHaveBeenCalled();
  });

  describe('el primero que falla responde, en el orden de la regla 2', () => {
    it('una solicitud inválida no consulta la disponibilidad, no cotiza ni guarda', async () => {
      const { service, check, verifyQuotes, insert } = aService();

      expect(
        await errorOf(service.execute({ ...REQUEST, startDate: '2026-10-08' })),
      ).toBe('START_DATE_IN_PAST');
      expect(check).not.toHaveBeenCalled();
      expect(verifyQuotes).not.toHaveBeenCalled();
      expect(insert).not.toHaveBeenCalled();
    });

    it('expectedRates sin moneda: RATE_CHANGED antes de consultar nada', async () => {
      const { service, check } = aService();

      expect(
        await errorOf(
          service.execute({
            ...REQUEST,
            expectedRates: [
              { position: 1, lodgingAmount: '750000.00' },
              { position: 2, lodgingAmount: '750000.00', currency: 'COP' },
            ],
          }),
        ),
      ).toBe('RATE_CHANGED');
      expect(check).not.toHaveBeenCalled();
    });

    it('sin disponibilidad no cotiza ni guarda (regla 3)', async () => {
      const { service, verifyQuotes, insert } = aService({
        availability: {
          ...BOTH_FREE,
          rooms: [
            aRoomAvailability(ROOM_201),
            aRoomAvailability(ROOM_202, {
              available: false,
              reason: 'RESERVED',
            }),
          ],
        },
      });

      expect(await errorOf(service.execute(REQUEST))).toBe('NO_AVAILABILITY');
      expect(verifyQuotes).not.toHaveBeenCalled();
      expect(insert).not.toHaveBeenCalled();
    });

    it('una habitación sin capacidad no cotiza ni guarda', async () => {
      const { service, verifyQuotes, insert } = aService();

      expect(
        await errorOf(
          service.execute({
            ...REQUEST,
            rooms: [{ guestCount: 3 }, { guestCount: 2 }],
            expectedRates: REQUEST.expectedRates,
          }),
        ),
      ).toBe('GUEST_COUNT_EXCEEDS_CAPACITY');
      expect(verifyQuotes).not.toHaveBeenCalled();
      expect(insert).not.toHaveBeenCalled();
    });

    it('la tarifa cambió: RATE_CHANGED y no se abre la transacción', async () => {
      const { service, verifyQuotes, calls } = aService();
      verifyQuotes.mockRejectedValue(
        new BusinessError(
          'RATE_CHANGED',
          'La tarifa cambió, vuelva a cotizar.',
        ),
      );

      expect(await errorOf(service.execute(REQUEST))).toBe('RATE_CHANGED');
      expect(calls).not.toContain('BEGIN');
    });
  });

  it('con una referencia que ya existe, prueba otra en una transacción nueva (regla 7)', async () => {
    let attempt = 0;
    const { service, insert, detailOf } = aService({
      insert: (reservation) => {
        attempt += 1;
        return attempt === 1
          ? Promise.reject(
              new DuplicateReservationRefError(reservation.reservationRef),
            )
          : Promise.resolve(reservation);
      },
    });

    await service.execute(REQUEST);

    expect(insert).toHaveBeenCalledTimes(2);
    expect(inserted(insert, 1).reservationRef).not.toBe(
      inserted(insert, 0).reservationRef,
    );
    expect(detailOf).toHaveBeenCalledExactlyOnceWith(
      inserted(insert, 1).reservationRef,
    );
  });

  it('si la base falla al guardar, el error sale y no se lee ningún detalle', async () => {
    const { service, detailOf } = aService({
      insert: () => Promise.reject(new Error('se cayó la conexión')),
    });

    await expect(service.execute(REQUEST)).rejects.toThrow(
      'se cayó la conexión',
    );
    expect(detailOf).not.toHaveBeenCalled();
  });

  describe('los avisos, dentro de la transacción de la reserva (regla 8 y T010)', () => {
    it('la lista del día recibe la reserva guardada, sin estado anterior, en la misma transacción', async () => {
      const { service, insert, recordDailyList } = aService();

      await service.execute(REQUEST);

      expect(recordDailyList).toHaveBeenCalledExactlyOnceWith(
        TX,
        null,
        inserted(insert),
      );
    });

    it('Channex recibe la categoría y las noches que ocupa, de la entrada a la salida, en la misma transacción', async () => {
      const { service, recordAvailability } = aService();

      await service.execute(REQUEST);

      expect(recordAvailability).toHaveBeenCalledExactlyOnceWith(TX, [
        { categoryRoom: 'DOBLE', dateFrom: '2026-10-12', dateTo: '2026-10-15' },
      ]);
    });

    it('si un aviso falla, la transacción no se confirma y no se lee el detalle', async () => {
      const { service, calls, detailOf, recordAvailability } = aService({
        recordDailyList: () => Promise.reject(new Error('se cayó la conexión')),
      });

      await expect(service.execute(REQUEST)).rejects.toThrow(
        'se cayó la conexión',
      );
      expect(calls).not.toContain('COMMIT');
      expect(recordAvailability).not.toHaveBeenCalled();
      expect(detailOf).not.toHaveBeenCalled();
    });

    it('con una referencia repetida, los avisos solo van con la reserva que sí se guardó', async () => {
      let attempt = 0;
      const { service, insert, recordDailyList, recordAvailability } = aService(
        {
          insert: (reservation) => {
            attempt += 1;
            return attempt === 1
              ? Promise.reject(
                  new DuplicateReservationRefError(reservation.reservationRef),
                )
              : Promise.resolve(reservation);
          },
        },
      );

      await service.execute(REQUEST);

      expect(recordDailyList).toHaveBeenCalledExactlyOnceWith(
        TX,
        null,
        inserted(insert, 1),
      );
      expect(recordAvailability).toHaveBeenCalledTimes(1);
    });
  });

  describe('la Idempotency-Key (punto 15, T019)', () => {
    it.each([
      ['sin la cabecera', undefined],
      ['vacía', ''],
      ['que no es un UUID', 'una-clave'],
      ['repetida en la cabecera', [KEY, KEY]],
    ])('%s: IDEMPOTENCY_KEY_REQUIRED, sin consultar nada', async (_, key) => {
      const { real, check, findKey } = aService();

      expect(await errorOf(real.execute(REQUEST, key))).toBe(
        'IDEMPOTENCY_KEY_REQUIRED',
      );
      expect(findKey).not.toHaveBeenCalled();
      expect(check).not.toHaveBeenCalled();
    });

    it('se guarda en la transacción de la reserva, en minúsculas y con el hash del cuerpo', async () => {
      const { real, saveKey, insert } = aService();

      await real.execute(REQUEST, KEY.toUpperCase());

      const [tx, entry, expiredBefore] = saveKey.mock.calls[0];
      expect(tx).toBe(TX);
      expect(entry).toEqual({
        key: KEY,
        requestHash: expect.stringMatching(/^[0-9a-f]{64}$/) as string,
        reservationId: inserted(insert).id,
      });
      expect(expiredBefore).toEqual(new Date('2026-10-08T15:00:00.000Z'));
    });

    it('escenario 8: la misma clave con el mismo cuerpo responde la misma reserva, sin validar, verificar ni cotizar otra vez', async () => {
      const { real, check, verifyQuotes, insert, detailOf } = aService();
      await real.execute(REQUEST, KEY);
      check.mockClear();
      verifyQuotes.mockClear();
      insert.mockClear();
      detailOf.mockClear();

      // El mismo cuerpo, con las claves en otro orden: es el mismo.
      const reordered = Object.fromEntries(Object.entries(REQUEST).reverse());
      const detail = await real.execute(reordered, KEY);

      expect(detail).toEqual({ reservationRef: 'RSV-DE5A11ED' });
      expect(detailOf).toHaveBeenCalledExactlyOnceWith('RSV-DE5A11ED');
      expect(check).not.toHaveBeenCalled();
      expect(verifyQuotes).not.toHaveBeenCalled();
      expect(insert).not.toHaveBeenCalled();
    });

    it('la misma clave con otro cuerpo: IDEMPOTENCY_KEY_REUSED, sin crear nada', async () => {
      const { real, insert } = aService();
      await real.execute(REQUEST, KEY);
      insert.mockClear();

      expect(
        await errorOf(real.execute({ ...REQUEST, notes: 'Otra nota' }, KEY)),
      ).toBe('IDEMPOTENCY_KEY_REUSED');
      expect(insert).not.toHaveBeenCalled();
    });

    it('una clave vencida (de hace más de 24 horas) cuenta como nueva', async () => {
      const storedKeys = new Map<string, StoredIdempotencyKey>([
        [
          KEY,
          {
            requestHash: 'otro',
            reservationRef: 'RSV-0LD00000',
            createdAt: new Date('2026-10-08T15:00:00.000Z'),
          },
        ],
      ]);
      const { real, insert } = aService({ storedKeys });

      await real.execute(REQUEST, KEY);

      expect(insert).toHaveBeenCalledTimes(1);
    });

    it('si otra solicitud con la misma clave confirmó primero, responde su reserva', async () => {
      const storedKeys = new Map<string, StoredIdempotencyKey>();
      const { real, detailOf } = aService({
        storedKeys,
        saveKey: (_tx, entry) => {
          // La otra solicitud se guardó entre la consulta y el COMMIT.
          storedKeys.set(entry.key, {
            requestHash: entry.requestHash,
            reservationRef: 'RSV-0THE2000',
            createdAt: NOW,
          });
          return Promise.reject(new DuplicateIdempotencyKeyError());
        },
      });

      const detail = await real.execute(REQUEST, KEY);

      expect(detail).toEqual({ reservationRef: 'RSV-0THE2000' });
      expect(detailOf).toHaveBeenLastCalledWith('RSV-0THE2000');
    });
  });
});
