import { describe, expect, it, vi } from 'vitest';
import type { Room } from '../../../../../src/application/integration/room.js';
import type {
  RoomQuote,
  RoomQuoteRequest,
} from '../../../../../src/application/integration/room-quote.js';
import type { Clock } from '../../../../../src/application/ports/out/clock.js';
import type { CalculateDynamicRate } from '../../../../../src/application/use-cases/calculate-dynamic-rate/ports/in/calculate-dynamic-rate.port.js';
import type { VerifyAvailability } from '../../../../../src/application/use-cases/check-room-availability/ports/in/verify-availability.port.js';
import type { ReservationLookup } from '../../../../../src/application/use-cases/check-view-reservation/ports/in/reservation-lookup.port.js';
import type { ConsultRoomInventory } from '../../../../../src/application/use-cases/consult-room-inventory/ports/in/consult-room-inventory.port.js';
import { PreviewModificationService } from '../../../../../src/application/use-cases/update-reservation/preview-modification.service.js';
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

/** Una habitación de la reserva, con su tarifa. */
const stayIn = (room: Room, guestCount: number, amount: string) =>
  aDirectRoom({
    roomId: room.id,
    roomNumber: room.roomNumber,
    categoryRoom: room.categoryRoom,
    guestCount,
    rate: { roomGrossAmount: Money.of(amount, 'COP'), quoteId: 'Q-old' },
  });

/** La reserva directa del ejemplo: la 201 con 2 personas (500000) y la 202 con 1 (450000). */
const aReservation = (changes: Partial<ReservationProps> = {}) =>
  aDirectReservation({
    startDate: START,
    endDate: END,
    rooms: [stayIn(r201, 2, '500000.00'), stayIn(r202, 1, '450000.00')],
    guest: aGuest(),
    notes: 'Llegada tarde',
    updatedAt: UPDATED_AT_DB,
    ...changes,
  });

/** Una cotización del Módulo 3 para una habitación: 300000 por noche, 2 noches. */
const quoteFor = (request: RoomQuoteRequest): RoomQuote => ({
  key: request.key,
  quoteId: `Q-${request.key}`,
  currency: 'COP',
  nightlyRates: [
    { date: request.startDate, rate: Money.of('300000.00', 'COP') },
  ],
  lodgingAmount: Money.of('600000.00', 'COP'),
});

/** El servicio con los puertos simulados. `unavailable`: los `roomId` que no están libres. */
function aPreview(
  reservation: Reservation | null = aReservation(),
  { unavailable = [] as string[], concurrency = 5 } = {},
) {
  const calls: string[] = [];
  const findByRef = vi.fn((ref: string) => {
    calls.push(`findByRef ${ref}`);
    return Promise.resolve(reservation);
  });
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
  const quoteRooms = vi.fn<CalculateDynamicRate['quoteRooms']>((requests) => {
    calls.push(`quoteRooms ${requests.map(({ key }) => key).join(',')}`);
    return Promise.resolve(requests.map(quoteFor));
  });
  const clock: Clock = {
    today: () => TODAY,
    now: () => new Date('2031-03-12T15:00:00.000Z'),
  };
  const service = new PreviewModificationService(
    { findByRef } as unknown as ReservationLookup,
    { byRoomId } as unknown as ConsultRoomInventory,
    { check } as VerifyAvailability,
    { quoteRooms } as unknown as CalculateDynamicRate,
    clock,
    concurrency,
  );
  return { service, findByRef, byRoomId, check, quoteRooms, calls };
}

/** El error de negocio que lanza la vista previa. */
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

describe('PreviewModificationService (plan de update-reservation, B1, D1 y regla 8; T009)', () => {
  describe('el orden de la regla 3: el primero que falla responde', () => {
    it('paso 1, la forma: un cuerpo mal formado responde sin buscar la reserva', async () => {
      const { service, findByRef } = aPreview();

      expect(
        await codeOf(service.execute('RSV-3F9A1C7B', change({ rooms: {} }))),
      ).toBe('INVALID_ROOM_COUNT');
      expect(findByRef).not.toHaveBeenCalled();
    });

    it('paso 2: una reserva que no existe (también con una referencia mal formada) es RESERVATION_NOT_FOUND', async () => {
      const { service, findByRef } = aPreview(null);

      const error = await errorOf(service.execute('no-es-una-ref', change()));

      expect(error).toMatchObject({
        errorCode: 'RESERVATION_NOT_FOUND',
        message: 'La reserva no existe.',
      });
      expect(findByRef).toHaveBeenCalledExactlyOnceWith('no-es-una-ref');
    });

    it('paso 2: una reserva de Booking es OTA_RESERVATION_READ_ONLY', async () => {
      const { service } = aPreview(
        anOtaReservation('9b1f2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d', {
          startDate: START,
          endDate: END,
          updatedAt: UPDATED_AT_DB,
        }),
      );

      const error = await errorOf(service.execute('RSV-3F9A1C7B', change()));

      expect(error).toMatchObject({
        errorCode: 'OTA_RESERVATION_READ_ONLY',
        message:
          'Las reservas de OTA solo las modifica Booking. Si está en conflicto, solo se le puede asignar la habitación.',
      });
    });

    it('paso 2: una de Booking ya en curso también es OTA_RESERVATION_READ_ONLY: el canal va antes que el estado', async () => {
      const { service } = aPreview(
        anOtaReservation('9b1f2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d', {
          status: 'IN_PROGRESS',
          startDate: START,
          endDate: END,
          updatedAt: UPDATED_AT_DB,
        }),
      );

      expect(await codeOf(service.execute('RSV-3F9A1C7B', change()))).toBe(
        'OTA_RESERVATION_READ_ONLY',
      );
    });

    it.each(['IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW'] as const)(
      'paso 2: una reserva %s es STATUS_NOT_EDITABLE',
      async (status) => {
        const { service } = aPreview(aReservation({ status }));

        const error = await errorOf(service.execute('RSV-3F9A1C7B', change()));

        expect(error).toMatchObject({
          errorCode: 'STATUS_NOT_EDITABLE',
          message: 'El estado actual de la reserva no admite modificaciones.',
        });
      },
    );

    it('una reserva PENDING sí se puede modificar', async () => {
      const { service } = aPreview(aReservation({ status: 'PENDING' }));

      await expect(
        service.execute('RSV-3F9A1C7B', change({ notes: 'Otra nota' })),
      ).resolves.toMatchObject({ changes: { notesChanged: true } });
    });

    it.each([
      ['otro instante', { updatedAt: '2031-03-12T10:00:00.123457-05:00' }],
      ['sin updatedAt', { updatedAt: undefined }],
      ['un texto que no es una fecha', { updatedAt: 'ayer' }],
    ])('paso 3: %s es CONCURRENT_UPDATE', async (_, changes) => {
      const { service } = aPreview();

      const error = await errorOf(
        service.execute('RSV-3F9A1C7B', change(changes)),
      );

      expect(error).toMatchObject({
        errorCode: 'CONCURRENT_UPDATE',
        message: 'Esta reserva ya fue actualizada o cancelada recientemente',
      });
    });

    it('paso 3: una reserva sin updatedAt guardado no coincide con ninguno', async () => {
      const { service } = aPreview(aReservation({ updatedAt: null }));

      expect(await codeOf(service.execute('RSV-3F9A1C7B', change()))).toBe(
        'CONCURRENT_UPDATE',
      );
    });

    it('paso 3: el mismo instante escrito como ISO y como lo da la base coincide', async () => {
      const { service } = aPreview();

      await expect(
        service.execute('RSV-3F9A1C7B', change()),
      ).resolves.toBeDefined();
    });

    it('paso 4: la entrada antes de hoy es START_DATE_IN_PAST, antes de consultar al Módulo 1', async () => {
      const { service, byRoomId } = aPreview();

      expect(
        await codeOf(
          service.execute(
            'RSV-3F9A1C7B',
            change({
              startDate: '2031-03-11',
              rooms: rooms([r201, 3]),
            }),
          ),
        ),
      ).toBe('START_DATE_IN_PAST');
      expect(byRoomId).not.toHaveBeenCalled();
    });

    it('paso 4: con solo la salida, se compara con la entrada actual (INVALID_RESERVATION_DATES)', async () => {
      const { service } = aPreview();

      expect(
        await codeOf(
          service.execute('RSV-3F9A1C7B', change({ endDate: START })),
        ),
      ).toBe('INVALID_RESERVATION_DATES');
    });

    it('paso 4: las fechas se revisan aunque no cambien', async () => {
      const { service } = aPreview(
        aReservation({ startDate: '2031-03-11', endDate: END }),
      );

      expect(
        await codeOf(
          service.execute('RSV-3F9A1C7B', change({ notes: 'Otra nota' })),
        ),
      ).toBe('START_DATE_IN_PAST');
    });

    it.each([
      ['vacía', [], 'LAST_ROOM_CANNOT_BE_REMOVED'],
      [
        'con una repetida',
        rooms([r201, 1], [r201, 1]),
        'ROOM_ALREADY_IN_RESERVATION',
      ],
      [
        'de 11',
        Array.from({ length: 11 }, () => ({ roomId: r201.id, guestCount: 1 })),
        'INVALID_ROOM_COUNT',
      ],
    ])(
      'paso 5: la lista %s responde sin consultar al Módulo 1',
      async (_, list, code) => {
        const { service, byRoomId } = aPreview();

        expect(
          await codeOf(
            service.execute('RSV-3F9A1C7B', change({ rooms: list })),
          ),
        ).toBe(code);
        expect(byRoomId).not.toHaveBeenCalled();
      },
    );

    it('paso 5: un roomId que el Módulo 1 no reconoce es su error (INVALID_ROOM_ID)', async () => {
      const { service } = aPreview();

      expect(
        await codeOf(
          service.execute(
            'RSV-3F9A1C7B',
            change({
              rooms: [
                ...rooms([r201, 2]),
                {
                  roomId: '9a9a9a9a-9a9a-4a9a-8a9a-9a9a9a9a9a9a',
                  guestCount: 1,
                },
              ],
            }),
          ),
        ),
      ).toBe('INVALID_ROOM_ID');
    });

    it('paso 5: consulta al Módulo 1 en paralelo, con como mucho MAINTENANCE_CONCURRENCY a la vez (NFR-001)', async () => {
      const { service, byRoomId } = aPreview(aReservation(), {
        concurrency: 2,
      });
      const roomOf = (roomId: string) =>
        Object.values(ROOM).find(({ id }) => id === roomId) as Room;
      let inFlight = 0;
      let most = 0;
      byRoomId.mockImplementation(async (roomId) => {
        inFlight += 1;
        most = Math.max(most, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return roomOf(roomId);
      });

      const preview = await service.execute(
        'RSV-3F9A1C7B',
        change({ rooms: rooms([r202, 1], [r201, 2], [r203, 1]) }),
      );

      expect(most).toBe(2);
      expect(byRoomId.mock.calls.map(([roomId]) => roomId)).toEqual([
        r202.id,
        r201.id,
        r203.id,
      ]);
      expect(preview.reservation.guestCount).toBe(4);
    });

    it('paso 5: si fallan dos, responde la primera de la solicitud aunque la otra conteste antes', async () => {
      const { service, byRoomId } = aPreview();
      byRoomId.mockImplementation(async (roomId) => {
        if (roomId === r201.id) {
          // La primera de la solicitud contesta tarde.
          await new Promise((resolve) => setTimeout(resolve, 20));
          throw new BusinessError(
            'INVENTORY_UNAVAILABLE',
            'No se pudo consultar el inventario de habitaciones. Intente más tarde.',
          );
        }
        throw new BusinessError(
          'INVALID_ROOM_ID',
          'El identificador de la habitación es inválido.',
        );
      });

      expect(
        await codeOf(
          service.execute(
            'RSV-3F9A1C7B',
            change({ rooms: rooms([r201, 2], [r202, 1]) }),
          ),
        ),
      ).toBe('INVENTORY_UNAVAILABLE');
    });

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
      'paso 6: %i personas en la 201 (capacidad 2) es %s',
      async (guestCount, code, message) => {
        const { service } = aPreview();

        const error = await errorOf(
          service.execute(
            'RSV-3F9A1C7B',
            change({ rooms: rooms([r201, guestCount], [r202, 1]) }),
          ),
        );

        expect(error).toMatchObject({ errorCode: code, message });
      },
    );

    it('paso 6 antes que el 7: la capacidad responde antes que la nacionalidad', async () => {
      const { service } = aPreview();

      expect(
        await codeOf(
          service.execute(
            'RSV-3F9A1C7B',
            change({
              rooms: rooms([r201, 3]),
              guest: { nationality: 'Colombia' },
            }),
          ),
        ),
      ).toBe('GUEST_COUNT_EXCEEDS_CAPACITY');
    });

    it('paso 7: el titular con nacionalidad es NATIONALITY_NOT_EDITABLE, antes de verificar la disponibilidad', async () => {
      const { service, check } = aPreview();

      expect(
        await codeOf(
          service.execute(
            'RSV-3F9A1C7B',
            change({
              startDate: '2031-03-21',
              guest: { nationality: 'Colombia' },
            }),
          ),
        ),
      ).toBe('NATIONALITY_NOT_EDITABLE');
      expect(check).not.toHaveBeenCalled();
    });

    it('paso 8: una habitación que no está libre es ROOM_NOT_AVAILABLE con su número, y no se cotiza (FR-002)', async () => {
      const { service, quoteRooms } = aPreview(aReservation(), {
        unavailable: [r202.id],
      });

      const error = await errorOf(
        service.execute('RSV-3F9A1C7B', change({ endDate: '2031-03-23' })),
      );

      expect(error).toMatchObject({
        errorCode: 'ROOM_NOT_AVAILABLE',
        message:
          'La habitación 202 no está disponible para el rango de fechas solicitado.',
      });
      expect(quoteRooms).not.toHaveBeenCalled();
    });

    it('paso 8: verifica en paralelo, con como mucho MAINTENANCE_CONCURRENCY a la vez (NFR-001)', async () => {
      const { service, check } = aPreview(aReservation(), { concurrency: 2 });
      const answer = check.getMockImplementation();
      let inFlight = 0;
      let most = 0;
      check.mockImplementation(async (query) => {
        inFlight += 1;
        most = Math.max(most, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return answer?.(query) as ReturnType<VerifyAvailability['check']>;
      });

      const preview = await service.execute(
        'RSV-3F9A1C7B',
        change({
          endDate: '2031-03-23',
          rooms: rooms([r201, 2], [r202, 1], [r203, 1]),
        }),
      );

      expect(most).toBe(2);
      expect(preview.availability.map(({ room }) => room.roomNumber)).toEqual([
        '201',
        '202',
        '203',
      ]);
    });

    it('paso 8: la primera de la solicitud no disponible responde, aunque otra falle antes con un error', async () => {
      const { service, check } = aPreview(aReservation(), {
        unavailable: [r201.id],
      });
      const answer = check.getMockImplementation();
      check.mockImplementation(async (query) => {
        if (query.roomId === r202.id) {
          throw new BusinessError(
            'MAINTENANCE_CHECK_UNAVAILABLE',
            'No se pudo verificar el calendario de mantenimiento. Intente más tarde.',
          );
        }
        // La 201 contesta tarde.
        await new Promise((resolve) => setTimeout(resolve, 20));
        return answer?.(query) as ReturnType<VerifyAvailability['check']>;
      });

      const error = await errorOf(
        service.execute('RSV-3F9A1C7B', change({ endDate: '2031-03-23' })),
      );

      expect(error).toMatchObject({
        errorCode: 'ROOM_NOT_AVAILABLE',
        message:
          'La habitación 201 no está disponible para el rango de fechas solicitado.',
      });
    });

    it('paso 8: un error de la primera de la solicitud responde, aunque la siguiente no esté disponible', async () => {
      const { service, check } = aPreview(aReservation(), {
        unavailable: [r202.id],
      });
      const answer = check.getMockImplementation();
      check.mockImplementation(async (query) => {
        if (query.roomId === r201.id) {
          await new Promise((resolve) => setTimeout(resolve, 20));
          throw new BusinessError(
            'MAINTENANCE_CHECK_UNAVAILABLE',
            'No se pudo verificar el calendario de mantenimiento. Intente más tarde.',
          );
        }
        return answer?.(query) as ReturnType<VerifyAvailability['check']>;
      });

      expect(
        await codeOf(
          service.execute('RSV-3F9A1C7B', change({ endDate: '2031-03-23' })),
        ),
      ).toBe('MAINTENANCE_CHECK_UNAVAILABLE');
    });

    it('paso 9: si el Módulo 3 no responde, sale su error (RECALCULATION_UNAVAILABLE)', async () => {
      const { service, quoteRooms } = aPreview();
      quoteRooms.mockRejectedValueOnce(
        new BusinessError(
          'RECALCULATION_UNAVAILABLE',
          'No se pudo calcular la nueva tarifa en este momento. Intente más tarde.',
        ),
      );

      expect(
        await codeOf(
          service.execute('RSV-3F9A1C7B', change({ endDate: '2031-03-23' })),
        ),
      ).toBe('RECALCULATION_UNAVAILABLE');
    });
  });

  describe('sin recotizar ni verificar la disponibilidad (FR-004)', () => {
    it('solo las observaciones: sin Módulo 1, sin disponibilidad y sin Módulo 3', async () => {
      const { service, byRoomId, check, quoteRooms } = aPreview();

      const preview = await service.execute(
        'RSV-3F9A1C7B',
        change({ notes: 'Llega a las 11 p. m.' }),
      );

      expect(byRoomId).not.toHaveBeenCalled();
      expect(check).not.toHaveBeenCalled();
      expect(quoteRooms).not.toHaveBeenCalled();
      expect(preview).toEqual({
        reservationRef: expect.stringMatching(/^RSV-/) as string,
        changes: {
          dates: false,
          roomsAdded: [],
          roomsRemoved: [],
          roomsSwapped: [],
          guestCountChanged: false,
          guestChanged: false,
          notesChanged: true,
        },
        requiresConfirmation: false,
        availability: [],
        quotes: null,
        reservation: { startDate: START, endDate: END, guestCount: 3 },
      });
    });

    it('solo las personas (escenario 11): consulta la capacidad al Módulo 1, pero ni disponibilidad ni Módulo 3', async () => {
      const { service, check, quoteRooms } = aPreview();

      const preview = await service.execute(
        'RSV-3F9A1C7B',
        change({ rooms: rooms([r201, 2], [r202, 2]) }),
      );

      expect(check).not.toHaveBeenCalled();
      expect(quoteRooms).not.toHaveBeenCalled();
      expect(preview.changes).toMatchObject({
        guestCountChanged: true,
        roomsAdded: [],
        roomsSwapped: [],
      });
      expect(preview.reservation.guestCount).toBe(4);
      expect(preview.quotes).toBeNull();
    });

    it('una habitación por otra de la misma categoría (escenarios 6 y 7): verifica la nueva y no cotiza', async () => {
      const { service, calls } = aPreview();

      const preview = await service.execute(
        'RSV-3F9A1C7B',
        change({ rooms: rooms([r201, 2], [r203, 1]) }),
      );

      expect(calls.filter((call) => !call.startsWith('byRoomId'))).toEqual([
        'findByRef RSV-3F9A1C7B',
        `check ${r203.id}`,
      ]);
      expect(preview.changes).toMatchObject({
        roomsSwapped: [{ from: r202.id, to: r203.id }],
        roomsAdded: [],
        roomsRemoved: [],
        guestCountChanged: false,
      });
      expect(preview.availability.map(({ room }) => room.roomNumber)).toEqual([
        '203',
      ]);
      expect(preview).toMatchObject({
        requiresConfirmation: false,
        quotes: null,
      });
    });

    it('quitar una habitación (escenario 9): sin disponibilidad ni Módulo 3', async () => {
      const { service, check, quoteRooms } = aPreview();

      const preview = await service.execute(
        'RSV-3F9A1C7B',
        change({ rooms: rooms([r201, 2]) }),
      );

      expect(check).not.toHaveBeenCalled();
      expect(quoteRooms).not.toHaveBeenCalled();
      expect(preview.changes).toMatchObject({
        roomsRemoved: [r202.id],
        guestCountChanged: true,
      });
      expect(preview.reservation.guestCount).toBe(2);
    });

    it('un roomId en mayúsculas es la misma habitación: se conserva, sin verificar ni cotizar', async () => {
      const { service, check } = aPreview();

      const preview = await service.execute(
        'RSV-3F9A1C7B',
        change({
          rooms: [
            { roomId: r201.id.toUpperCase(), guestCount: 2 },
            { roomId: r202.id, guestCount: 1 },
          ],
        }),
      );

      expect(check).not.toHaveBeenCalled();
      expect(preview.changes.roomsAdded).toEqual([]);
    });
  });

  describe('con recotización (FR-002 y FR-003)', () => {
    it('cambian las fechas (escenario 1): verifica y cotiza todas las que quedan, sin la propia reserva', async () => {
      const reservation = aReservation();
      const { service, check, quoteRooms } = aPreview(reservation);

      const preview = await service.execute(
        reservation.reservationRef,
        change({ startDate: '2031-03-21', endDate: '2031-03-24' }),
      );

      expect(check.mock.calls.map(([query]) => query)).toEqual([
        {
          roomId: r201.id,
          startDate: '2031-03-21',
          endDate: '2031-03-24',
          excludeReservationRef: reservation.reservationRef,
        },
        {
          roomId: r202.id,
          startDate: '2031-03-21',
          endDate: '2031-03-24',
          excludeReservationRef: reservation.reservationRef,
        },
      ]);
      expect(quoteRooms).toHaveBeenCalledExactlyOnceWith(
        [
          {
            key: r201.id,
            categoryRoom: 'DOBLE',
            startDate: '2031-03-21',
            endDate: '2031-03-24',
          },
          {
            key: r202.id,
            categoryRoom: 'DOBLE',
            startDate: '2031-03-21',
            endDate: '2031-03-24',
          },
        ],
        'RECALCULATION',
      );
      expect(preview).toMatchObject({
        changes: { dates: true, guestCountChanged: false },
        requiresConfirmation: true,
        reservation: {
          startDate: '2031-03-21',
          endDate: '2031-03-24',
          guestCount: 3,
        },
      });
      expect(preview.availability.map(({ room }) => room.roomNumber)).toEqual([
        '201',
        '202',
      ]);
      // Todas recotizadas: el total es la suma de las cotizaciones nuevas.
      expect(preview.quotes?.total).toEqual(Money.of('1200000.00', 'COP'));
      expect(preview.quotes?.quotes.map(({ key }) => key)).toEqual([
        r201.id,
        r202.id,
      ]);
    });

    it('agregar una habitación (escenario 8): verifica y cotiza solo la agregada; el total suma las demás con su tarifa', async () => {
      const { service, check, quoteRooms } = aPreview();

      const preview = await service.execute(
        'RSV-3F9A1C7B',
        change({ rooms: rooms([r201, 2], [r202, 1], [r305, 2]) }),
      );

      expect(check.mock.calls.map(([query]) => query.roomId)).toEqual([
        r305.id,
      ]);
      expect(quoteRooms).toHaveBeenCalledExactlyOnceWith(
        [
          {
            key: r305.id,
            categoryRoom: 'SUITE',
            startDate: START,
            endDate: END,
          },
        ],
        'RECALCULATION',
      );
      expect(preview.changes).toMatchObject({
        roomsAdded: [r305.id],
        guestCountChanged: true,
      });
      // 500000 de la 201 + 450000 de la 202 + 600000 de la 305 recotizada.
      expect(preview.quotes?.total).toEqual(Money.of('1550000.00', 'COP'));
      expect(preview.reservation.guestCount).toBe(5);
    });

    it('cambiar una habitación por otra de otra categoría: se verifica y se cotiza la nueva', async () => {
      const { service, check, quoteRooms } = aPreview();

      const preview = await service.execute(
        'RSV-3F9A1C7B',
        change({ rooms: rooms([r201, 2], [r305, 1]) }),
      );

      expect(check.mock.calls.map(([query]) => query.roomId)).toEqual([
        r305.id,
      ]);
      expect(quoteRooms.mock.calls[0][0].map(({ key }) => key)).toEqual([
        r305.id,
      ]);
      expect(preview.changes.roomsSwapped).toEqual([
        { from: r202.id, to: r305.id },
      ]);
      // 500000 de la 201 + 600000 de la 305.
      expect(preview.quotes?.total).toEqual(Money.of('1100000.00', 'COP'));
    });

    it('la que cambia por otra de la misma categoría hereda la tarifa de la que sale en el total', async () => {
      const { service } = aPreview();

      const preview = await service.execute(
        'RSV-3F9A1C7B',
        change({ rooms: rooms([r201, 2], [r203, 1], [r305, 2]) }),
      );

      // 500000 de la 201 + 450000 que la 203 hereda de la 202 + 600000 de la 305 recotizada.
      expect(preview.quotes?.total).toEqual(Money.of('1550000.00', 'COP'));
      expect(preview.changes).toMatchObject({
        roomsSwapped: [{ from: r202.id, to: r203.id }],
        roomsAdded: [r305.id],
      });
    });

    it('verifica y cotiza en el orden de la solicitud', async () => {
      const { service, calls } = aPreview();

      await service.execute(
        'RSV-3F9A1C7B',
        change({
          endDate: '2031-03-23',
          rooms: rooms([r305, 1], [r201, 2]),
        }),
      );

      expect(calls.filter((call) => !call.startsWith('byRoomId'))).toEqual([
        'findByRef RSV-3F9A1C7B',
        `check ${r305.id}`,
        `check ${r201.id}`,
        `quoteRooms ${r305.id},${r201.id}`,
      ]);
    });
  });

  describe('qué cambia (changes)', () => {
    it('el titular con los mismos datos no cuenta como cambio, y con uno distinto sí', async () => {
      const current = aGuest();
      const sameHolder = {
        firstName: current.firstName,
        lastName: current.lastName,
        documentType: current.documentType,
        documentNumber: current.documentNumber,
        contactPhone: current.contactPhone,
        contactEmail: current.contactEmail,
      };
      const { service } = aPreview(aReservation({ guest: current }));

      const same = await service.execute(
        'RSV-3F9A1C7B',
        change({ guest: sameHolder }),
      );
      const other = await service.execute(
        'RSV-3F9A1C7B',
        change({ guest: { ...sameHolder, contactPhone: '+57 310 000 0000' } }),
      );

      expect(same.changes.guestChanged).toBe(false);
      expect(other.changes.guestChanged).toBe(true);
    });

    it.each([
      ['las mismas observaciones', 'Llegada tarde', false],
      ['borrarlas (null)', null, true],
      ['otras', 'Llega a las 11 p. m.', true],
    ])('notes con %s: notesChanged %s', async (_, notes, changed) => {
      const { service } = aPreview();

      const preview = await service.execute('RSV-3F9A1C7B', change({ notes }));

      expect(preview.changes.notesChanged).toBe(changed);
    });

    it('las personas cambian de una habitación a otra sin cambiar la suma: guestCountChanged igual es true', async () => {
      const { service } = aPreview();

      const preview = await service.execute(
        'RSV-3F9A1C7B',
        change({ rooms: rooms([r201, 1], [r202, 2]) }),
      );

      expect(preview.reservation.guestCount).toBe(3);
      expect(preview.changes.guestCountChanged).toBe(true);
    });

    it('cambiar solo la salida marca dates aunque la entrada no cambie', async () => {
      const { service } = aPreview();

      const preview = await service.execute(
        'RSV-3F9A1C7B',
        change({ endDate: '2031-03-23' }),
      );

      expect(preview.changes.dates).toBe(true);
      expect(preview.reservation).toMatchObject({
        startDate: START,
        endDate: '2031-03-23',
      });
    });
  });
});
