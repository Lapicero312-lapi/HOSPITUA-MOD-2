import { describe, expect, it, vi } from 'vitest';
import type { Room } from '../../../../../src/application/integration/room.js';
import type { Clock } from '../../../../../src/application/ports/out/clock.js';
import {
  type ReservationRepository,
  RoomOverlapError,
} from '../../../../../src/application/ports/out/reservation.repository.js';
import type {
  Transaction,
  TransactionRunner,
} from '../../../../../src/application/ports/out/transaction.js';
import type { VerifyAvailability } from '../../../../../src/application/use-cases/check-room-availability/ports/in/verify-availability.port.js';
import type { DailyListChangeRecorder } from '../../../../../src/application/use-cases/check-view-reservation/ports/in/daily-list-change-recorder.port.js';
import type {
  GetReservationDetail,
  ReservationDetail,
} from '../../../../../src/application/use-cases/check-view-reservation/ports/in/get-reservation-detail.port.js';
import type { ReservationLookup } from '../../../../../src/application/use-cases/check-view-reservation/ports/in/reservation-lookup.port.js';
import type { AriChangeRecorder } from '../../../../../src/application/use-cases/configure-ota/ports/in/ari-change-recorder.port.js';
import type { ConsultRoomInventory } from '../../../../../src/application/use-cases/consult-room-inventory/ports/in/consult-room-inventory.port.js';
import { AssignRoomService } from '../../../../../src/application/use-cases/update-reservation/assign-room.service.js';
import type {
  Reservation,
  ReservationProps,
} from '../../../../../src/domain/reservation/reservation.js';
import { BusinessError } from '../../../../../src/domain/shared/business-error.js';
import {
  aDirectReservation,
  anOtaReservation,
  anOtaRoom,
} from '../../../../support/builders.js';

const UPDATED_AT_DB = '2031-03-12 10:00:00.123456-05';
const UPDATED_AT = '2031-03-12T10:00:00.123456-05:00';
const NOW = new Date('2031-03-12T15:00:00.000Z');
const DETECTED_AT = new Date('2031-03-01T10:00:00.000Z');
const TX = {} as Transaction;
const DETAIL = { marker: 'C3' } as unknown as ReservationDetail;

const room = (n: string, categoryRoom: string, maxCapacity: number) =>
  ({
    id: `00000000-0000-4000-8000-000000000${n}`,
    roomNumber: n,
    categoryRoom,
    maxCapacity,
  }) satisfies Room;
const r201 = room('201', 'DOBLE', 2);
const r202 = room('202', 'DOBLE', 3);
const r203 = room('203', 'DOBLE', 1);
const r305 = room('305', 'SUITE', 2);
const ALL = [r201, r202, r203, r305];

/** Las habitaciones de la reserva: una sin asignar de DOBLE con 2 personas y la 201 asignada. */
const unassigned = anOtaRoom({
  id: '11111111-1111-4111-8111-111111111111',
  roomId: null,
  roomNumber: null,
  categoryRoom: 'DOBLE',
  guestCount: 2,
});
const assigned201 = anOtaRoom({
  id: '22222222-2222-4222-8222-222222222222',
  roomId: r201.id,
  roomNumber: '201',
  categoryRoom: 'DOBLE',
  guestCount: 2,
});

/** La reserva de Booking en conflicto por la habitación sin asignar. */
const aReservation = (changes: Partial<ReservationProps> = {}) =>
  anOtaReservation('ota-1', {
    reservationRef: 'RSV-8D02E5A4',
    startDate: '2031-03-20',
    endDate: '2031-03-22',
    rooms: [unassigned],
    conflict: { reason: 'NO_ROOM_AVAILABLE', detectedAt: DETECTED_AT },
    updatedAt: UPDATED_AT_DB,
    ...changes,
  });

function anAssign(
  reservation: Reservation | null = aReservation(),
  { busy = [] as Room[], locked = reservation, blocking = [] as string[] } = {},
) {
  const findByRef = vi.fn(() => Promise.resolve(reservation));
  const findForUpdate = vi.fn(() => Promise.resolve(locked));
  const findBlockingRooms = vi.fn<ReservationLookup['findBlockingRooms']>(
    (roomIds) =>
      Promise.resolve(
        roomIds
          .filter((id) => blocking.includes(id))
          .map((roomId) => ({ roomId, reservationRef: 'RSV-0000AAAA' })),
      ),
  );
  const byRoomId = vi.fn((roomId: string) => {
    const found = ALL.find(({ id }) => id === roomId);
    return found === undefined
      ? Promise.reject(new BusinessError('INVALID_ROOM_ID', 'inválido'))
      : Promise.resolve(found);
  });
  const check = vi.fn<VerifyAvailability['check']>((query) => {
    const found = ALL.find(({ id }) => id === query.roomId) as Room;
    return Promise.resolve({
      startDate: query.startDate,
      endDate: query.endDate,
      rooms: [
        {
          room: found,
          available: !busy.includes(found),
          reason: busy.includes(found) ? ('RESERVED' as const) : null,
          maintenance: [],
        },
      ],
    });
  });
  const run = vi.fn(<T>(work: (tx: Transaction) => Promise<T>) => work(TX));
  const update = vi.fn<ReservationRepository['update']>((saved) =>
    Promise.resolve(saved),
  );
  const record = vi.fn<DailyListChangeRecorder['record']>(() =>
    Promise.resolve(),
  );
  const ari = vi.fn<AriChangeRecorder['record']>(() => Promise.resolve());
  const execute = vi.fn(() => Promise.resolve(DETAIL));
  const clock: Clock = { today: () => '2031-03-12', now: () => NOW };
  const service = new AssignRoomService(
    {
      findByRef,
      findForUpdate,
      findBlockingRooms,
    } as unknown as ReservationLookup,
    { byRoomId } as unknown as ConsultRoomInventory,
    { check } as VerifyAvailability,
    { run } as unknown as TransactionRunner,
    { update } as unknown as ReservationRepository,
    { record } as DailyListChangeRecorder,
    { record: ari } as AriChangeRecorder,
    { execute } as GetReservationDetail,
    clock,
    5,
  );
  return {
    service,
    findByRef,
    byRoomId,
    check,
    run,
    update,
    record,
    ari,
    execute,
  };
}

const body = (
  assignments: unknown,
  updatedAt: string | undefined = UPDATED_AT,
) => ({ updatedAt, assignments });
const assign = (target = unassigned, chosen: Room = r202) => [
  { reservationRoomId: target.id, roomId: chosen.id },
];

const codeOf = async (promise: Promise<unknown>) => {
  const error: unknown = await promise.catch((thrown: unknown) => thrown);
  expect(error).toBeInstanceOf(BusinessError);
  return (error as BusinessError).errorCode;
};

const savedOf = (update: ReturnType<typeof anAssign>['update']) =>
  update.mock.calls[0][0];

describe('AssignRoomService (plan de update-reservation, B3 y punto 16; FR-025; T027)', () => {
  describe('paso 1: la forma, sin consultar nada', () => {
    it.each<[string, unknown, string]>([
      ['assignments no es una lista', 'x', 'INVALID_ROOM_ID'],
      ['assignments vacía', [], 'INVALID_ROOM_ID'],
      [
        'más de 10',
        Array.from({ length: 11 }, () => assign()[0]),
        'INVALID_ROOM_ID',
      ],
      [
        'un roomId que no es un UUID',
        [{ reservationRoomId: unassigned.id, roomId: '202' }],
        'INVALID_ROOM_ID',
      ],
      ['sin reservationRoomId', [{ roomId: r202.id }], 'INVALID_ROOM_ID'],
      [
        'la misma habitación dos veces',
        [
          { reservationRoomId: unassigned.id, roomId: r202.id },
          { reservationRoomId: assigned201.id, roomId: r202.id },
        ],
        'ROOM_ALREADY_IN_RESERVATION',
      ],
      [
        'la misma habitación de la reserva dos veces',
        [
          { reservationRoomId: unassigned.id, roomId: r202.id },
          { reservationRoomId: unassigned.id, roomId: r203.id },
        ],
        'ROOM_ALREADY_IN_RESERVATION',
      ],
    ])('%s: %s', async (_case, assignments, code) => {
      const { service, findByRef } = anAssign();

      expect(
        await codeOf(service.execute('RSV-8D02E5A4', body(assignments))),
      ).toBe(code);
      expect(findByRef).not.toHaveBeenCalled();
    });
  });

  describe('pasos 2 a 6, en orden', () => {
    it.each<[string, Reservation | null, string]>([
      ['la reserva no existe', null, 'RESERVATION_NOT_FOUND'],
      [
        'una reserva directa',
        aDirectReservation({ updatedAt: UPDATED_AT_DB }),
        'RESERVATION_NOT_IN_CONFLICT',
      ],
      [
        'una de Booking sin conflicto',
        aReservation({ conflict: null, rooms: [assigned201] }),
        'RESERVATION_NOT_IN_CONFLICT',
      ],
    ])('%s: %s', async (_case, reservation, code) => {
      const { service, byRoomId } = anAssign(reservation);

      expect(
        await codeOf(service.execute('RSV-8D02E5A4', body(assign()))),
      ).toBe(code);
      expect(byRoomId).not.toHaveBeenCalled();
    });

    it('otro updatedAt, o sin él: CONCURRENT_UPDATE', async () => {
      const { service } = anAssign();

      expect(
        await codeOf(
          service.execute(
            'RSV-8D02E5A4',
            body(assign(), '2031-03-12T10:00:00.999999-05:00'),
          ),
        ),
      ).toBe('CONCURRENT_UPDATE');
      expect(
        await codeOf(
          service.execute('RSV-8D02E5A4', { assignments: assign() }),
        ),
      ).toBe('CONCURRENT_UPDATE');
    });

    it('una habitación de la reserva ya asignada, o que no es suya: ROOM_ALREADY_ASSIGNED', async () => {
      const reservation = aReservation({ rooms: [unassigned, assigned201] });
      const { service, byRoomId } = anAssign(reservation);

      expect(
        await codeOf(
          service.execute('RSV-8D02E5A4', body(assign(assigned201))),
        ),
      ).toBe('ROOM_ALREADY_ASSIGNED');
      expect(
        await codeOf(
          service.execute(
            'RSV-8D02E5A4',
            body([
              {
                reservationRoomId: '33333333-3333-4333-8333-333333333333',
                roomId: r202.id,
              },
            ]),
          ),
        ),
      ).toBe('ROOM_ALREADY_ASSIGNED');
      expect(byRoomId).not.toHaveBeenCalled();
    });

    it('otra categoría: CATEGORY_MISMATCH, sin verificar la disponibilidad', async () => {
      const { service, check } = anAssign();

      expect(
        await codeOf(
          service.execute('RSV-8D02E5A4', body(assign(unassigned, r305))),
        ),
      ).toBe('CATEGORY_MISMATCH');
      expect(check).not.toHaveBeenCalled();
    });

    it('menos capacidad que las personas: GUEST_COUNT_EXCEEDS_CAPACITY', async () => {
      const { service, check } = anAssign();

      expect(
        await codeOf(
          service.execute('RSV-8D02E5A4', body(assign(unassigned, r203))),
        ),
      ).toBe('GUEST_COUNT_EXCEEDS_CAPACITY');
      expect(check).not.toHaveBeenCalled();
    });

    it('con la capacidad justa (2 personas en la 201, de capacidad 2) sí se asigna', async () => {
      const { service, update } = anAssign();

      await service.execute('RSV-8D02E5A4', body(assign(unassigned, r201)));

      expect(update.mock.calls[0][0].rooms[0].roomNumber).toBe('201');
    });

    it('no disponible: ROOM_NOT_AVAILABLE con su número, sin abrir la transacción', async () => {
      const { service, check, run } = anAssign(aReservation(), {
        busy: [r202],
      });

      const error: unknown = await service
        .execute('RSV-8D02E5A4', body(assign()))
        .catch((thrown: unknown) => thrown);

      expect(error).toMatchObject({
        errorCode: 'ROOM_NOT_AVAILABLE',
        message:
          'La habitación 202 no está disponible para el rango de fechas solicitado.',
      });
      expect(check).toHaveBeenCalledWith({
        roomId: r202.id,
        startDate: '2031-03-20',
        endDate: '2031-03-22',
        excludeReservationRef: 'RSV-8D02E5A4',
      });
      expect(run).not.toHaveBeenCalled();
    });
  });

  describe('el conflicto que queda y la transacción', () => {
    it('asigna la única sin asignar: quita el conflicto, guarda y avisa, y responde el detalle', async () => {
      const reservation = aReservation();
      const { service, update, record, ari, execute } = anAssign(reservation);

      const detail = await service.execute('RSV-8D02E5A4', body(assign()));

      const saved = savedOf(update);
      expect(saved.rooms[0].snapshot()).toEqual({
        ...unassigned.snapshot(),
        roomId: r202.id,
        roomNumber: '202',
      });
      expect(saved.conflict).toBeNull();
      expect(update).toHaveBeenCalledWith(saved, TX);
      expect(record).toHaveBeenCalledWith(TX, reservation, saved);
      expect(ari).toHaveBeenCalledWith(TX, [
        { categoryRoom: 'DOBLE', dateFrom: '2031-03-20', dateTo: '2031-03-22' },
      ]);
      expect(execute).toHaveBeenCalledWith('RSV-8D02E5A4');
      expect(detail).toBe(DETAIL);
    });

    it('si aún queda otra sin asignar, el conflicto sigue con su hora', async () => {
      const second = anOtaRoom({
        id: '44444444-4444-4444-8444-444444444444',
        roomId: null,
        roomNumber: null,
        categoryRoom: 'DOBLE',
        guestCount: 1,
      });
      const { service, update } = anAssign(
        aReservation({ rooms: [unassigned, second] }),
      );

      await service.execute('RSV-8D02E5A4', body(assign()));

      expect(savedOf(update).conflict).toEqual({
        reason: 'NO_ROOM_AVAILABLE',
        detectedAt: DETECTED_AT,
      });
    });

    it('si otra asignada supera su capacidad, queda CAPACITY_EXCEEDED desde ahora', async () => {
      const crowded = anOtaRoom({
        id: '55555555-5555-4555-8555-555555555555',
        roomId: r203.id,
        roomNumber: '203',
        categoryRoom: 'DOBLE',
        guestCount: 2,
      });
      const { service, update } = anAssign(
        aReservation({ rooms: [unassigned, crowded] }),
      );

      await service.execute('RSV-8D02E5A4', body(assign()));

      expect(savedOf(update).conflict).toEqual({
        reason: 'CAPACITY_EXCEEDED',
        detectedAt: NOW,
      });
    });

    it('con fechas distintas por habitación (CHANGE_NOT_APPLICABLE), el conflicto se conserva', async () => {
      const { service, update } = anAssign(
        aReservation({
          conflict: {
            reason: 'CHANGE_NOT_APPLICABLE',
            detectedAt: DETECTED_AT,
          },
        }),
      );

      await service.execute('RSV-8D02E5A4', body(assign()));

      expect(savedOf(update).conflict).toEqual({
        reason: 'CHANGE_NOT_APPLICABLE',
        detectedAt: DETECTED_AT,
      });
    });

    it('si dentro de la transacción ya cambió: CONCURRENT_UPDATE, sin guardar', async () => {
      const { service, update } = anAssign(aReservation(), {
        locked: aReservation({ updatedAt: '2031-03-12 10:05:00.000001-05' }),
      });

      expect(
        await codeOf(service.execute('RSV-8D02E5A4', body(assign()))),
      ).toBe('CONCURRENT_UPDATE');
      expect(update).not.toHaveBeenCalled();
    });

    it('la restricción anti-solape: ROOM_NOT_AVAILABLE con la que ocupa otra reserva, sin avisar', async () => {
      const { service, update, record } = anAssign(aReservation(), {
        blocking: [r202.id],
      });
      update.mockRejectedValueOnce(new RoomOverlapError());

      const error: unknown = await service
        .execute('RSV-8D02E5A4', body(assign()))
        .catch((thrown: unknown) => thrown);

      expect(error).toMatchObject({
        errorCode: 'ROOM_NOT_AVAILABLE',
        message:
          'La habitación 202 no está disponible para el rango de fechas solicitado.',
      });
      expect(record).not.toHaveBeenCalled();
    });

    it('un roomId en mayúsculas se busca en minúsculas', async () => {
      const { service, byRoomId } = anAssign();

      await service.execute(
        'RSV-8D02E5A4',
        body([
          {
            reservationRoomId: unassigned.id.toUpperCase(),
            roomId: r202.id.toUpperCase(),
          },
        ]),
      );

      expect(byRoomId).toHaveBeenCalledWith(r202.id);
    });
  });
});
