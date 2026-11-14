import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  BookingRevision,
  BookingRevisionRoom,
} from '../../../../../src/application/integration/booking-revision.js';
import type { Room } from '../../../../../src/application/integration/room.js';
import type { Clock } from '../../../../../src/application/ports/out/clock.js';
import {
  DuplicateOtaBookingRevisionError,
  type OtaBookingRevisionRepository,
} from '../../../../../src/application/ports/out/ota-booking-revision.repository.js';
import type { OtaRoomTypeMappingRepository } from '../../../../../src/application/ports/out/ota-room-type-mapping.repository.js';
import {
  DuplicateReservationRefError,
  type ReservationRepository,
  RoomOverlapError,
} from '../../../../../src/application/ports/out/reservation.repository.js';
import type {
  Transaction,
  TransactionRunner,
} from '../../../../../src/application/ports/out/transaction.js';
import type { CancelReservation } from '../../../../../src/application/use-cases/cancel-reservation/ports/in/cancel-reservation.port.js';
import type {
  AvailabilityResult,
  VerifyAvailability,
} from '../../../../../src/application/use-cases/check-room-availability/ports/in/verify-availability.port.js';
import type { DailyListChangeRecorder } from '../../../../../src/application/use-cases/check-view-reservation/ports/in/daily-list-change-recorder.port.js';
import type { AriChangeRecorder } from '../../../../../src/application/use-cases/configure-ota/ports/in/ari-change-recorder.port.js';
import { ProcessBookingRevisionService } from '../../../../../src/application/use-cases/generate-ota-reservation/process-booking-revision.service.js';
import type { ManageOta } from '../../../../../src/application/use-cases/register-ota-information-commission/ports/in/manage-ota.port.js';
import type {
  ApplyOtaChange,
  OtaChangePlan,
} from '../../../../../src/application/use-cases/update-reservation/ports/in/apply-ota-change.port.js';
import type {
  CommissionResult,
  RegisterOtaConfirmationAndCommission,
} from '../../../../../src/application/use-cases/register-ota-information-commission/ports/in/register-ota-confirmation-and-commission.port.js';
import type { Reservation } from '../../../../../src/domain/reservation/reservation.js';
import { BusinessError } from '../../../../../src/domain/shared/business-error.js';
import { Money } from '../../../../../src/domain/shared/money.js';
import { anOta, anOtaReservation } from '../../../../support/builders.js';

/** Una transacción opaca: lo que reciben los puertos que escriben. */
const TX = { tx: 'de la revisión' } as unknown as Transaction;
const NOW = new Date('2026-11-10T15:00:00.000Z');
const OTA_ID = '6f1b8c2a-3d4e-4f5a-8b6c-7d8e9f0a1b2c';
const DOBLE_TYPE = '994d1375-dbbd-4072-8724-b2ab32ce781b';
const SUITE_TYPE = '1e2d3c4b-5a69-4788-9a0b-1c2d3e4f5a6b';

const room = (
  roomNumber: string,
  maxCapacity = 2,
  categoryRoom = 'DOBLE',
): Room => ({
  id: `00000000-0000-4000-8000-${roomNumber.padStart(12, '0')}`,
  roomNumber,
  categoryRoom,
  maxCapacity,
});

function aRevisionRoom(
  changes: Partial<BookingRevisionRoom> = {},
): BookingRevisionRoom {
  return {
    roomTypeId: DOBLE_TYPE,
    ratePlanId: '445835fb-7956-42ac-9efc-3e6f331f0808',
    checkinDate: '2026-11-10',
    checkoutDate: '2026-11-12',
    adults: 2,
    children: 0,
    infants: 0,
    ...changes,
  };
}

/** La revisión del ejemplo de A1 del plan. */
function aRevision(changes: Partial<BookingRevision> = {}): BookingRevision {
  return {
    id: '03dd7198-c5b7-493c-a889-74d0c2211de7',
    bookingId: 'cfa33f3b-bd32-4b90-8ef9-bde2bfe986cd',
    otaReservationCode: '9996013801',
    otaName: 'Booking.com',
    status: 'new',
    arrivalDate: '2026-11-10',
    departureDate: '2026-11-12',
    amount: Money.of('220.00', 'USD'),
    otaCommission: Money.of('33.00', 'USD'),
    notes: 'Llegada tarde',
    customer: {
      name: 'Ana',
      surname: 'Pérez',
      mail: 'ana@correo.com',
      phone: '+57 300 000 0000',
      country: 'CO',
    },
    rooms: [aRevisionRoom()],
    ...changes,
  };
}

/** Lo que devuelve `calculate`: 15 % de 220 USD, aprendido con esta revisión. */
const COMMISSION: CommissionResult = {
  otaId: OTA_ID,
  commissionPercentage: '15.00',
  learnedPercentage: true,
  commissionAmount: Money.of('33.00', 'USD'),
  commissionStatus: 'CALCULATED',
};

/** Las habitaciones libres de cada categoría, en orden de `roomNumber`. */
const availabilityOf = (rooms: Room[]): AvailabilityResult => ({
  startDate: '2026-11-10',
  endDate: '2026-11-12',
  rooms: rooms.map((free) => ({
    room: free,
    available: true,
    reason: null,
    maintenance: [],
  })),
});

type Options = {
  processed?: boolean;
  existing?: Reservation | null;
  mappings?: Record<string, string>;
  free?: Record<string, Room[]>;
  commission?: () => Promise<CommissionResult>;
  insert?: (reservation: Reservation) => Promise<Reservation>;
  record?: () => Promise<void>;
  /** Lo que guarda `ApplyOtaChange.apply`: por defecto, la reserva que recibió `prepare`. */
  apply?: (plan: OtaChangePlan) => Promise<Reservation>;
  prepare?: () => Promise<void>;
};

function aService(options: Options = {}) {
  const mappings = options.mappings ?? { [DOBLE_TYPE]: 'DOBLE' };
  const free = options.free ?? { DOBLE: [room('201'), room('202')] };
  const findById = vi.fn(() =>
    Promise.resolve(
      options.processed === true
        ? ({
            revisionId: aRevision().id,
          } as Awaited<ReturnType<OtaBookingRevisionRepository['findById']>>)
        : null,
    ),
  );
  const recordRevision = vi.fn(options.record ?? (() => Promise.resolve()));
  const register = vi.fn(() => Promise.resolve(anOta({ id: OTA_ID })));
  const setCommissionPercentage = vi.fn(() => Promise.resolve());
  const findByCode = vi.fn(() =>
    Promise.resolve(options.existing === undefined ? null : options.existing),
  );
  const insert = vi.fn(
    options.insert ??
      ((reservation: Reservation) => Promise.resolve(reservation)),
  );
  const update = vi.fn((reservation: Reservation, _tx?: Transaction) =>
    Promise.resolve(reservation),
  );
  const findByChannexRoomType = vi.fn((id: string) =>
    Promise.resolve(
      mappings[id] === undefined
        ? null
        : {
            channexRoomTypeId: id,
            categoryRoom: mappings[id],
            countOfRooms: 2,
            occupancy: 2,
          },
    ),
  );
  const check = vi.fn(({ categoryRoom }: { categoryRoom: string }) =>
    Promise.resolve(availabilityOf(free[categoryRoom] ?? [])),
  );
  const calculate = vi.fn(
    options.commission ?? (() => Promise.resolve(COMMISSION)),
  );
  const recordAudit = vi.fn(() => Promise.resolve());
  const run = vi.fn((work: (tx: Transaction) => Promise<unknown>) => work(TX));
  const dailyList = vi.fn(() => Promise.resolve());
  const ari = vi.fn(() => Promise.resolve());
  const cancel = vi.fn(() => Promise.resolve({} as Reservation));
  const prepare = vi.fn(
    async (
      reservation: Reservation,
      change: Parameters<ApplyOtaChange['prepare']>[1],
    ): Promise<OtaChangePlan> => {
      await options.prepare?.();
      return {
        reservation,
        change,
        rooms: [],
        conflictReason: null,
        commission: null,
      };
    },
  );
  const apply = vi.fn(
    (_tx: Transaction, plan: OtaChangePlan): Promise<Reservation> =>
      options.apply?.(plan) ?? Promise.resolve(plan.reservation),
  );
  const clock: Clock = { today: () => '2026-11-10', now: () => NOW };

  const service = new ProcessBookingRevisionService(
    {
      findById,
      record: recordRevision,
    } as unknown as OtaBookingRevisionRepository,
    { register, setCommissionPercentage } as unknown as ManageOta,
    clock,
    {
      findByOtaConfirmationCode: findByCode,
      insert,
      update,
    } as unknown as ReservationRepository,
    { findByChannexRoomType } as unknown as OtaRoomTypeMappingRepository,
    { check } as unknown as VerifyAvailability,
    {
      calculate,
      recordAudit,
    } as unknown as RegisterOtaConfirmationAndCommission,
    { run, afterCommit: vi.fn() } as unknown as TransactionRunner,
    { record: dailyList } as unknown as DailyListChangeRecorder,
    { record: ari } as unknown as AriChangeRecorder,
    { cancel } as unknown as CancelReservation,
    { prepare, apply } as unknown as ApplyOtaChange,
  );
  return {
    service,
    findById,
    recordRevision,
    register,
    setCommissionPercentage,
    findByCode,
    insert,
    update,
    findByChannexRoomType,
    check,
    calculate,
    recordAudit,
    run,
    dailyList,
    ari,
    cancel,
    prepare,
    apply,
  };
}

/** La reserva que se insertó. */
const inserted = (insert: ReturnType<typeof aService>['insert']) =>
  insert.mock.calls[0][0];

describe('ProcessBookingRevision (plan de generate-ota-reservation, B1, B2, B3 y punto 9)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('pasos 1 a 3', () => {
    it('una revisión ya procesada solo se vuelve a confirmar: no mapea, no busca ni abre una transacción', async () => {
      const deps = aService({ processed: true });

      expect(await deps.service.process(aRevision())).toEqual({
        kind: 'ACKNOWLEDGE',
      });
      expect(deps.findById).toHaveBeenCalledWith(aRevision().id);
      expect(deps.register).not.toHaveBeenCalled();
      expect(deps.findByCode).not.toHaveBeenCalled();
      expect(deps.run).not.toHaveBeenCalled();
    });

    it('una revisión ilegible queda en el feed (RETRY con su motivo), sin buscar ni guardar nada', async () => {
      const deps = aService();

      const outcome = await deps.service.process(
        aRevision({ otaReservationCode: null }),
      );

      expect(outcome.kind).toBe('RETRY');
      expect(outcome).toMatchObject({
        reason: expect.stringContaining('ilegible') as string,
      });
      expect(deps.findByCode).not.toHaveBeenCalled();
      expect(deps.run).not.toHaveBeenCalled();
    });

    it('busca la reserva por el código de Booking en la agencia Booking.com, registrada con la hora del Clock', async () => {
      const deps = aService();

      await deps.service.process(aRevision());

      expect(deps.register).toHaveBeenCalledWith({ name: 'Booking.com' }, NOW);
      expect(deps.findByCode).toHaveBeenCalledWith(OTA_ID, '9996013801');
    });
  });

  describe('new (T006): B1, pasos 3 a 10', () => {
    it('la reserva del ejemplo: ACTIVE, la 201, la comisión y su auditoría, los avisos y la revisión APPLIED', async () => {
      const deps = aService();

      expect(await deps.service.process(aRevision())).toEqual({
        kind: 'ACKNOWLEDGE',
      });

      const reservation = inserted(deps.insert);
      expect(reservation.status).toBe('ACTIVE');
      expect(reservation.source).toBe('OTA');
      expect(reservation.startDate).toBe('2026-11-10');
      expect(reservation.endDate).toBe('2026-11-12');
      expect(reservation.conflict).toBeNull();
      expect(reservation.rooms.map((r) => r.roomNumber)).toEqual(['201']);
      expect(reservation.ota).toMatchObject({
        otaId: OTA_ID,
        externalConfirmationCode: '9996013801',
        commissionPercentage: '15.00',
        commissionStatus: 'CALCULATED',
      });
      expect(
        reservation.ota?.grossAmount.equals(Money.of('220.00', 'USD')),
      ).toBe(true);
      expect(reservation.guest.documentNumber).toBeNull();
      expect(reservation.guest.nationality).toBe('Colombia');
      expect(deps.calculate).toHaveBeenCalledWith({
        otaId: OTA_ID,
        grossAmount: expect.anything() as Money,
        reportedCommission: expect.anything() as Money,
        externalConfirmationCode: '9996013801',
      });
      expect(deps.recordAudit).toHaveBeenCalledWith(
        TX,
        reservation.id,
        COMMISSION,
        'Booking.com',
      );
      expect(deps.dailyList).toHaveBeenCalledWith(TX, null, reservation);
      expect(deps.ari).toHaveBeenCalledWith(TX, [
        { categoryRoom: 'DOBLE', dateFrom: '2026-11-10', dateTo: '2026-11-12' },
      ]);
      expect(deps.recordRevision).toHaveBeenCalledWith(
        {
          revisionId: aRevision().id,
          otaId: OTA_ID,
          bookingId: aRevision().bookingId,
          status: 'new',
          reservationId: reservation.id,
          result: 'APPLIED',
        },
        TX,
      );
    });

    it('con el porcentaje aprendido, lo guarda en la agencia en la misma transacción', async () => {
      const deps = aService();

      await deps.service.process(aRevision());

      expect(deps.setCommissionPercentage).toHaveBeenCalledWith(
        TX,
        OTA_ID,
        '15.00',
      );
    });

    it('con el porcentaje ya fijo, no lo vuelve a guardar', async () => {
      const deps = aService({
        commission: () =>
          Promise.resolve({ ...COMMISSION, learnedPercentage: false }),
      });

      await deps.service.process(aRevision());

      expect(deps.setCommissionPercentage).not.toHaveBeenCalled();
      expect(deps.insert).toHaveBeenCalledTimes(1);
    });

    it('varias habitaciones: una sola consulta por categoría, y la de menor roomNumber sin repetir', async () => {
      const deps = aService({
        mappings: { [DOBLE_TYPE]: 'DOBLE', [SUITE_TYPE]: 'SUITE' },
        free: {
          DOBLE: [room('201'), room('202')],
          SUITE: [room('101', 2, 'SUITE')],
        },
      });

      await deps.service.process(
        aRevision({
          rooms: [
            aRevisionRoom(),
            aRevisionRoom({ roomTypeId: SUITE_TYPE }),
            aRevisionRoom(),
          ],
        }),
      );

      expect(deps.check).toHaveBeenCalledTimes(2);
      expect(deps.check).toHaveBeenCalledWith({
        startDate: '2026-11-10',
        endDate: '2026-11-12',
        categoryRoom: 'DOBLE',
      });
      expect(inserted(deps.insert).rooms.map((r) => r.roomNumber)).toEqual([
        '201',
        '101',
        '202',
      ]);
      expect(deps.ari).toHaveBeenCalledWith(TX, [
        { categoryRoom: 'DOBLE', dateFrom: '2026-11-10', dateTo: '2026-11-12' },
        { categoryRoom: 'SUITE', dateFrom: '2026-11-10', dateTo: '2026-11-12' },
      ]);
    });

    it('sin habitación libre: la guarda sin asignar, con NO_ROOM_AVAILABLE, y la revisión CONFLICT', async () => {
      const deps = aService({ free: { DOBLE: [room('201')] } });

      expect(
        await deps.service.process(
          aRevision({ rooms: [aRevisionRoom(), aRevisionRoom()] }),
        ),
      ).toEqual({ kind: 'ACKNOWLEDGE' });

      const reservation = inserted(deps.insert);
      expect(reservation.rooms.map((r) => r.roomId)).toEqual([
        room('201').id,
        null,
      ]);
      expect(reservation.conflict).toEqual({
        reason: 'NO_ROOM_AVAILABLE',
        detectedAt: NOW,
      });
      expect(deps.recordRevision).toHaveBeenCalledWith(
        expect.objectContaining({ result: 'CONFLICT' }),
        TX,
      );
    });

    it('con más personas que la capacidad: CAPACITY_EXCEEDED', async () => {
      const deps = aService();

      await deps.service.process(
        aRevision({ rooms: [aRevisionRoom({ adults: 2, children: 1 })] }),
      );

      expect(inserted(deps.insert).conflict?.reason).toBe('CAPACITY_EXCEEDED');
    });

    it.each([
      ['la entrada', { checkinDate: '2026-11-11' }],
      ['la salida', { checkoutDate: '2026-11-11' }],
    ])(
      'T011c: una habitación con %s distinta: las fechas de la reserva y CHANGE_NOT_APPLICABLE',
      async (_, changes) => {
        const deps = aService();

        await deps.service.process(
          aRevision({ rooms: [aRevisionRoom(changes)] }),
        );

        const reservation = inserted(deps.insert);
        expect(reservation.startDate).toBe('2026-11-10');
        expect(reservation.endDate).toBe('2026-11-12');
        expect(reservation.conflict?.reason).toBe('CHANGE_NOT_APPLICABLE');
      },
    );

    it.each([
      ['un tipo sin relación con una categoría', { roomTypeId: SUITE_TYPE }],
      ['un tipo vacío (sin mapear en Channex)', { roomTypeId: null }],
    ])(
      'con %s: RETRY, sin consultar la disponibilidad ni guardar nada',
      async (_, changes) => {
        const deps = aService();

        const outcome = await deps.service.process(
          aRevision({ rooms: [aRevisionRoom(), aRevisionRoom(changes)] }),
        );

        expect(outcome.kind).toBe('RETRY');
        expect(deps.check).not.toHaveBeenCalled();
        expect(deps.calculate).not.toHaveBeenCalled();
        expect(deps.run).not.toHaveBeenCalled();
        // Un tipo vacío no se busca en la relación: ya se sabe que no está mapeado.
        expect(deps.findByChannexRoomType).not.toHaveBeenCalledWith(null);
      },
    );

    it('si calculate lanza un BusinessError: RETRY con el revisionId y el código, un log sin datos personales y nada guardado', async () => {
      const warn = vi
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      const deps = aService({
        commission: () =>
          Promise.reject(
            new BusinessError('COMMISSION_NOT_REPORTED', 'Sin comisión.'),
          ),
      });

      const outcome = await deps.service.process(aRevision());

      expect(outcome).toEqual({
        kind: 'RETRY',
        reason: `revisión ${aRevision().id}: COMMISSION_NOT_REPORTED`,
      });
      expect(deps.run).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledTimes(1);
      const line = String(warn.mock.calls[0][0]);
      expect(line).toContain(aRevision().id);
      expect(line).not.toContain('Ana');
      expect(line).not.toContain('ana@correo.com');
    });

    it('un error inesperado de calculate se propaga', async () => {
      const deps = aService({
        commission: () => Promise.reject(new Error('la base no responde')),
      });

      await expect(deps.service.process(aRevision())).rejects.toThrow(
        'la base no responde',
      );
      expect(deps.run).not.toHaveBeenCalled();
    });

    it('si la restricción anti-solape rechaza una habitación al guardar: RETRY, sin ack', async () => {
      const deps = aService({
        insert: () => Promise.reject(new RoomOverlapError()),
      });

      expect((await deps.service.process(aRevision())).kind).toBe('RETRY');
    });

    it('si otra lectura registró la misma revisión a la vez: ACKNOWLEDGE', async () => {
      const deps = aService({
        record: () =>
          Promise.reject(new DuplicateOtaBookingRevisionError(aRevision().id)),
      });

      expect(await deps.service.process(aRevision())).toEqual({
        kind: 'ACKNOWLEDGE',
      });
    });

    it('si la referencia ya existe, prueba con otra, cada vez en una transacción nueva', async () => {
      let attempts = 0;
      const deps = aService({
        insert: (reservation) => {
          attempts += 1;
          return attempts < 3
            ? Promise.reject(
                new DuplicateReservationRefError(reservation.reservationRef),
              )
            : Promise.resolve(reservation);
        },
      });

      expect((await deps.service.process(aRevision())).kind).toBe(
        'ACKNOWLEDGE',
      );
      expect(deps.run).toHaveBeenCalledTimes(3);
      const refs = deps.insert.mock.calls.map(([r]) => r.reservationRef);
      expect(new Set(refs).size).toBe(3);
    });

    it('al quinto choque de referencia se rinde y propaga el error', async () => {
      const deps = aService({
        insert: (reservation) =>
          Promise.reject(
            new DuplicateReservationRefError(reservation.reservationRef),
          ),
      });

      await expect(deps.service.process(aRevision())).rejects.toBeInstanceOf(
        DuplicateReservationRefError,
      );
      expect(deps.run).toHaveBeenCalledTimes(5);
    });

    it('una modified de una reserva desconocida se procesa como new (punto 1)', async () => {
      const deps = aService();

      expect(
        await deps.service.process(aRevision({ status: 'modified' })),
      ).toEqual({ kind: 'ACKNOWLEDGE' });
      expect(deps.insert).toHaveBeenCalledTimes(1);
      expect(deps.recordRevision).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'modified', result: 'APPLIED' }),
        TX,
      );
    });
  });

  describe('modified (T009): B2 con ApplyOtaChange', () => {
    const modified = (changes: Partial<BookingRevision> = {}) =>
      aRevision({ status: 'modified', ...changes });

    it.each(['modified', 'new'] as const)(
      'una %s de una reserva ACTIVE: prepare con el cambio de Booking, apply en la transacción y la revisión APPLIED',
      async (status) => {
        const existing = anOtaReservation(OTA_ID, { status: 'ACTIVE' });
        const deps = aService({ existing });

        expect(await deps.service.process(modified({ status }))).toEqual({
          kind: 'ACKNOWLEDGE',
        });
        expect(deps.prepare).toHaveBeenCalledWith(existing, {
          startDate: '2026-11-10',
          endDate: '2026-11-12',
          rooms: [{ categoryRoom: 'DOBLE', guestCount: 2 }],
          grossAmount: Money.of('220.00', 'USD'),
          notes: 'Llegada tarde',
          guest: {
            firstName: 'Ana',
            lastName: 'Pérez',
            contactEmail: 'ana@correo.com',
            contactPhone: '+57 300 000 0000',
            nationality: 'Colombia',
          },
          datesDifferPerRoom: false,
        });
        expect(deps.apply).toHaveBeenCalledWith(
          TX,
          expect.objectContaining({ reservation: existing }),
        );
        expect(deps.recordRevision).toHaveBeenCalledWith(
          expect.objectContaining({
            status,
            reservationId: existing.id,
            result: 'APPLIED',
          }),
          TX,
        );
        // Lo guarda y lo avisa ApplyOtaChange: aquí no se inserta, ni se actualiza, ni se avisa nada.
        expect(deps.insert).not.toHaveBeenCalled();
        expect(deps.update).not.toHaveBeenCalled();
        expect(deps.dailyList).not.toHaveBeenCalled();
        expect(deps.calculate).not.toHaveBeenCalled();
      },
    );

    it('una PENDING también se cambia', async () => {
      const deps = aService({
        existing: anOtaReservation(OTA_ID, { status: 'PENDING' }),
      });

      expect((await deps.service.process(modified())).kind).toBe('ACKNOWLEDGE');
      expect(deps.apply).toHaveBeenCalledTimes(1);
    });

    it('si la reserva guardada quedó en conflicto: la revisión CONFLICT', async () => {
      const existing = anOtaReservation(OTA_ID);
      const deps = aService({
        existing,
        apply: () =>
          Promise.resolve(existing.withConflict('CHANGE_NOT_APPLICABLE', NOW)),
      });

      await deps.service.process(modified());

      expect(deps.recordRevision).toHaveBeenCalledWith(
        expect.objectContaining({ result: 'CONFLICT' }),
        TX,
      );
    });

    it('habitaciones con fechas distintas de las de la reserva: datesDifferPerRoom (FR-012)', async () => {
      const deps = aService({ existing: anOtaReservation(OTA_ID) });

      await deps.service.process(
        modified({
          rooms: [aRevisionRoom({ checkoutDate: '2026-11-11' })],
        }),
      );

      expect(deps.prepare.mock.calls[0][1].datesDifferPerRoom).toBe(true);
    });

    it.each(['IN_PROGRESS', 'COMPLETED', 'NO_SHOW', 'CANCELLED'] as const)(
      'en %s: no la cambia, la marca CHANGE_NOT_APPLICABLE y la revisión CONFLICT',
      async (status) => {
        const existing = anOtaReservation(OTA_ID, { status });
        const deps = aService({ existing });

        expect((await deps.service.process(modified())).kind).toBe(
          'ACKNOWLEDGE',
        );
        expect(deps.prepare).not.toHaveBeenCalled();
        expect(deps.update.mock.calls[0][0].conflict).toEqual({
          reason: 'CHANGE_NOT_APPLICABLE',
          detectedAt: NOW,
        });
        expect(deps.update.mock.calls[0][1]).toBe(TX);
        expect(deps.recordRevision).toHaveBeenCalledWith(
          expect.objectContaining({
            reservationId: existing.id,
            result: 'CONFLICT',
          }),
          TX,
        );
      },
    );

    it('un tipo de habitación sin relación: RETRY, sin preparar nada', async () => {
      const deps = aService({
        existing: anOtaReservation(OTA_ID),
        mappings: {},
      });

      expect((await deps.service.process(modified())).kind).toBe('RETRY');
      expect(deps.prepare).not.toHaveBeenCalled();
      expect(deps.run).not.toHaveBeenCalled();
    });

    it('si prepare lanza un BusinessError (el Módulo 1 no responde): RETRY con el código, un log sin datos personales y nada guardado', async () => {
      const warn = vi
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => {});
      const deps = aService({
        existing: anOtaReservation(OTA_ID),
        prepare: () =>
          Promise.reject(
            new BusinessError(
              'INVENTORY_UNAVAILABLE',
              'El Módulo 1 no responde.',
            ),
          ),
      });

      expect(await deps.service.process(modified())).toEqual({
        kind: 'RETRY',
        reason: `revisión ${aRevision().id}: INVENTORY_UNAVAILABLE`,
      });
      expect(deps.run).not.toHaveBeenCalled();
      const logged = warn.mock.calls.map(([message]) => String(message)).join();
      expect(logged).toContain('INVENTORY_UNAVAILABLE');
      expect(logged).not.toContain('Ana');
      expect(logged).not.toContain('Pérez');
    });

    it('un error inesperado de prepare se propaga', async () => {
      const deps = aService({
        existing: anOtaReservation(OTA_ID),
        prepare: () => Promise.reject(new Error('inesperado')),
      });

      await expect(deps.service.process(modified())).rejects.toThrow(
        'inesperado',
      );
    });

    it.each([
      [
        'la reserva cambió desde prepare (CONCURRENT_UPDATE)',
        () =>
          new BusinessError(
            'CONCURRENT_UPDATE',
            'Esta reserva ya fue actualizada o cancelada recientemente',
          ),
      ],
      [
        'la restricción anti-solape rechaza una habitación',
        () => new RoomOverlapError(),
      ],
    ])('si %s: RETRY, sin ack', async (_case, error) => {
      const deps = aService({
        existing: anOtaReservation(OTA_ID),
        apply: () => Promise.reject(error()),
      });

      expect((await deps.service.process(modified())).kind).toBe('RETRY');
      expect(deps.recordRevision).not.toHaveBeenCalled();
    });

    it('si otra lectura registró la misma revisión a la vez: ACKNOWLEDGE', async () => {
      const deps = aService({
        existing: anOtaReservation(OTA_ID),
        record: () =>
          Promise.reject(new DuplicateOtaBookingRevisionError(aRevision().id)),
      });

      expect((await deps.service.process(modified())).kind).toBe('ACKNOWLEDGE');
    });

    it('otro BusinessError de apply se propaga', async () => {
      const deps = aService({
        existing: anOtaReservation(OTA_ID),
        apply: () =>
          Promise.reject(new BusinessError('OTRO', 'Otro error de negocio.')),
      });

      await expect(deps.service.process(modified())).rejects.toThrow(
        'Otro error de negocio.',
      );
    });
  });

  describe('cancelled (T010): B3', () => {
    const cancelled = () => aRevision({ status: 'cancelled' });

    it('sin reserva: la revisión IGNORED, sin reserva, y ACKNOWLEDGE', async () => {
      const deps = aService();

      expect(await deps.service.process(cancelled())).toEqual({
        kind: 'ACKNOWLEDGE',
      });
      expect(deps.recordRevision).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'cancelled',
          reservationId: null,
          result: 'IGNORED',
        }),
        TX,
      );
      expect(deps.cancel).not.toHaveBeenCalled();
      expect(deps.insert).not.toHaveBeenCalled();
    });

    it('ya CANCELLED: IGNORED, con su reserva, sin volver a cancelarla', async () => {
      const existing = anOtaReservation(OTA_ID, { status: 'CANCELLED' });
      const deps = aService({ existing });

      expect((await deps.service.process(cancelled())).kind).toBe(
        'ACKNOWLEDGE',
      );
      expect(deps.recordRevision).toHaveBeenCalledWith(
        expect.objectContaining({
          reservationId: existing.id,
          result: 'IGNORED',
        }),
        TX,
      );
      expect(deps.cancel).not.toHaveBeenCalled();
    });

    it.each(['ACTIVE', 'PENDING'] as const)(
      'en %s: CancelReservation con OTA_API y Booking.com, en la misma transacción, y APPLIED',
      async (status) => {
        const existing = anOtaReservation(OTA_ID, { status });
        const deps = aService({ existing });

        expect((await deps.service.process(cancelled())).kind).toBe(
          'ACKNOWLEDGE',
        );
        expect(deps.cancel).toHaveBeenCalledWith(TX, {
          reservationRef: existing.reservationRef,
          channel: 'OTA_API',
          processedBy: 'Booking.com',
          reason: null,
        });
        expect(deps.recordRevision).toHaveBeenCalledWith(
          expect.objectContaining({
            reservationId: existing.id,
            result: 'APPLIED',
          }),
          TX,
        );
        expect(deps.update).not.toHaveBeenCalled();
      },
    );

    it.each(['IN_PROGRESS', 'COMPLETED', 'NO_SHOW'] as const)(
      'en %s: no la cancela, marca CHANGE_NOT_APPLICABLE con la hora del Clock y la revisión CONFLICT',
      async (status) => {
        const existing = anOtaReservation(OTA_ID, { status });
        const deps = aService({ existing });

        expect((await deps.service.process(cancelled())).kind).toBe(
          'ACKNOWLEDGE',
        );
        expect(deps.cancel).not.toHaveBeenCalled();
        const [updated, tx] = deps.update.mock.calls[0] as unknown as [
          Reservation,
          Transaction,
        ];
        expect(tx).toBe(TX);
        expect(updated.status).toBe(status);
        expect(updated.conflict).toEqual({
          reason: 'CHANGE_NOT_APPLICABLE',
          detectedAt: NOW,
        });
        expect(deps.recordRevision).toHaveBeenCalledWith(
          expect.objectContaining({
            reservationId: existing.id,
            result: 'CONFLICT',
          }),
          TX,
        );
      },
    );

    it('si otra lectura registró la misma revisión a la vez: ACKNOWLEDGE', async () => {
      const deps = aService({
        record: () =>
          Promise.reject(new DuplicateOtaBookingRevisionError(aRevision().id)),
      });

      expect(await deps.service.process(cancelled())).toEqual({
        kind: 'ACKNOWLEDGE',
      });
    });

    it('un error inesperado al cancelar se propaga', async () => {
      const deps = aService({
        existing: anOtaReservation(OTA_ID, { status: 'ACTIVE' }),
      });
      deps.cancel.mockRejectedValueOnce(new Error('la base no responde'));

      await expect(deps.service.process(cancelled())).rejects.toThrow(
        'la base no responde',
      );
    });
  });
});
