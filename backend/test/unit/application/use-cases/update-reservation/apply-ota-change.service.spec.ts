import { describe, expect, it, vi } from 'vitest';
import type { Room } from '../../../../../src/application/integration/room.js';
import type { Clock } from '../../../../../src/application/ports/out/clock.js';
import type { ReservationRepository } from '../../../../../src/application/ports/out/reservation.repository.js';
import type { Transaction } from '../../../../../src/application/ports/out/transaction.js';
import type { VerifyAvailability } from '../../../../../src/application/use-cases/check-room-availability/ports/in/verify-availability.port.js';
import type { DailyListChangeRecorder } from '../../../../../src/application/use-cases/check-view-reservation/ports/in/daily-list-change-recorder.port.js';
import type { ReservationLookup } from '../../../../../src/application/use-cases/check-view-reservation/ports/in/reservation-lookup.port.js';
import type { AriChangeRecorder } from '../../../../../src/application/use-cases/configure-ota/ports/in/ari-change-recorder.port.js';
import type { RegisterOtaConfirmationAndCommission } from '../../../../../src/application/use-cases/register-ota-information-commission/ports/in/register-ota-confirmation-and-commission.port.js';
import { ApplyOtaChangeService } from '../../../../../src/application/use-cases/update-reservation/apply-ota-change.service.js';
import type { OtaChange } from '../../../../../src/application/use-cases/update-reservation/ports/in/apply-ota-change.port.js';
import type {
  Reservation,
  ReservationProps,
} from '../../../../../src/domain/reservation/reservation.js';
import { BusinessError } from '../../../../../src/domain/shared/business-error.js';
import { Money } from '../../../../../src/domain/shared/money.js';
import {
  anOtaReservation,
  anOtaRoom,
  aGuest,
  otaTerms,
} from '../../../../support/builders.js';

const OTA_ID = '5b0e7c1a-2f4d-4e8b-9c3a-1d6f8e2b7a90';
const UPDATED_AT_DB = '2031-03-12 10:00:00.123456-05';
const NOW = new Date('2031-03-12T15:00:00.000Z');
const TX = {} as Transaction;

/** Las habitaciones del Módulo 1: la 201 (capacidad 2), la 202 (3) y la 203 (2) de `DOBLE`, y la 305 de `SUITE`. */
const room = (roomNumber: string, categoryRoom: string, maxCapacity: number) =>
  ({
    id: `00000000-0000-4000-8000-000000000${roomNumber}`,
    roomNumber,
    categoryRoom,
    maxCapacity,
  }) satisfies Room;
const r201 = room('201', 'DOBLE', 2);
const r202 = room('202', 'DOBLE', 3);
const r203 = room('203', 'DOBLE', 2);
const r305 = room('305', 'SUITE', 2);
const ALL = [r201, r202, r203, r305];

/** Una habitación de la reserva de Booking, asignada o no. */
const stayIn = (
  assigned: Room | null,
  categoryRoom = 'DOBLE',
  guestCount = 2,
) =>
  anOtaRoom({
    roomId: assigned?.id ?? null,
    roomNumber: assigned?.roomNumber ?? null,
    categoryRoom,
    guestCount,
  });

/** La reserva de Booking: la 201 con 2 personas, 400 USD y 15 % de comisión. */
const aReservation = (changes: Partial<ReservationProps> = {}) =>
  anOtaReservation(OTA_ID, {
    reservationRef: 'RSV-8D02E5A4',
    startDate: '2031-03-20',
    endDate: '2031-03-22',
    rooms: [stayIn(r201)],
    updatedAt: UPDATED_AT_DB,
    ...changes,
  });

/** El cambio de Booking: las mismas fechas, la misma habitación y el mismo valor, salvo lo que se indique. */
const aChange = (changes: Partial<OtaChange> = {}): OtaChange => ({
  startDate: '2031-03-20',
  endDate: '2031-03-22',
  rooms: [{ categoryRoom: 'DOBLE', guestCount: 2 }],
  grossAmount: Money.of('400', 'USD'),
  notes: 'Llega tarde',
  guest: {
    firstName: 'John',
    lastName: 'Smith',
    contactEmail: 'john@correo.com',
    contactPhone: null,
    nationality: 'Estados Unidos',
  },
  datesDifferPerRoom: false,
  ...changes,
});

/** El servicio con los puertos simulados. `busy`: las habitaciones ocupadas en las fechas nuevas. */
function anApply({
  busy = [] as Room[],
  locked = undefined as Reservation | null | undefined,
} = {}) {
  const check = vi.fn<VerifyAvailability['check']>((query) =>
    Promise.resolve({
      startDate: query.startDate,
      endDate: query.endDate,
      rooms: ALL.filter(
        ({ categoryRoom }) => categoryRoom === query.categoryRoom,
      ).map((candidate) => ({
        room: candidate,
        available: !busy.includes(candidate),
        reason: busy.includes(candidate) ? ('RESERVED' as const) : null,
        maintenance: [],
      })),
    }),
  );
  const recalculate = vi.fn<
    RegisterOtaConfirmationAndCommission['recalculate']
  >((reservation, grossAmount) => ({
    otaId: OTA_ID,
    commissionPercentage: reservation.ota?.commissionPercentage ?? '0',
    learnedPercentage: false,
    commissionAmount: Money.of(
      (Number(grossAmount.amount) * 0.15).toFixed(2),
      grossAmount.currency,
    ),
    commissionStatus: 'CALCULATED',
  }));
  const recordAudit = vi.fn<
    RegisterOtaConfirmationAndCommission['recordAudit']
  >(() => Promise.resolve());
  const findForUpdate = vi.fn<ReservationLookup['findForUpdate']>((_tx, ref) =>
    Promise.resolve(
      locked === undefined ? aReservation({ reservationRef: ref }) : locked,
    ),
  );
  const update = vi.fn<ReservationRepository['update']>((saved) =>
    Promise.resolve(saved),
  );
  const record = vi.fn<DailyListChangeRecorder['record']>(() =>
    Promise.resolve(),
  );
  const ari = vi.fn<AriChangeRecorder['record']>(() => Promise.resolve());
  const clock: Clock = { today: () => '2031-03-12', now: () => NOW };
  const service = new ApplyOtaChangeService(
    { check } as VerifyAvailability,
    {
      recalculate,
      recordAudit,
    } as unknown as RegisterOtaConfirmationAndCommission,
    { findForUpdate } as unknown as ReservationLookup,
    { update } as unknown as ReservationRepository,
    { record } as DailyListChangeRecorder,
    { record: ari } as AriChangeRecorder,
    clock,
  );
  return {
    service,
    check,
    recalculate,
    recordAudit,
    findForUpdate,
    update,
    record,
    ari,
  };
}

/** Cómo quedan las habitaciones del plan: número (o sin asignar), si se conserva la fila, y personas. */
const planned = (
  plan: Awaited<ReturnType<ApplyOtaChangeService['prepare']>>,
  before: Reservation,
) =>
  plan.rooms.map(({ keptRoomId, room: assigned, categoryRoom, guestCount }) => [
    keptRoomId === null
      ? (assigned?.roomNumber ?? 'sin asignar')
      : `conserva ${before.rooms.find(({ id }) => id === keptRoomId)?.roomNumber}`,
    categoryRoom,
    guestCount,
  ]);

describe('ApplyOtaChangeService (plan de update-reservation, C4 y punto 15; FR-024; T026)', () => {
  describe('prepare: decide sin escribir', () => {
    it.each<[string, Partial<ReservationProps>]>([
      [
        'una reserva directa',
        { source: 'DIRECT', ota: null, rooms: [stayIn(r201)] },
      ],
      ['una reserva en curso', { status: 'IN_PROGRESS' }],
      ['una cancelada', { status: 'CANCELLED' }],
    ])('%s es un error del programa', async (_case, changes) => {
      const { service, check } = anApply();
      const reservation =
        changes.source === 'DIRECT'
          ? ({
              ...aReservation(),
              source: 'DIRECT',
              status: 'ACTIVE',
              reservationRef: 'RSV-8D02E5A4',
            } as unknown as Reservation)
          : aReservation(changes);

      await expect(service.prepare(reservation, aChange())).rejects.toThrow(
        /no admite un cambio de Booking/,
      );
      expect(check).not.toHaveBeenCalled();
    });

    it('consulta una vez cada categoría, con las fechas nuevas y sin contar la propia reserva', async () => {
      const { service, check } = anApply();

      await service.prepare(
        aReservation(),
        aChange({
          startDate: '2031-03-21',
          endDate: '2031-03-24',
          rooms: [
            { categoryRoom: 'DOBLE', guestCount: 2 },
            { categoryRoom: 'SUITE', guestCount: 1 },
            { categoryRoom: 'DOBLE', guestCount: 1 },
          ],
        }),
      );

      expect(check.mock.calls.map(([query]) => query)).toEqual([
        {
          categoryRoom: 'DOBLE',
          startDate: '2031-03-21',
          endDate: '2031-03-24',
          excludeReservationRef: 'RSV-8D02E5A4',
        },
        {
          categoryRoom: 'SUITE',
          startDate: '2031-03-21',
          endDate: '2031-03-24',
          excludeReservationRef: 'RSV-8D02E5A4',
        },
      ]);
    });

    it('conserva la habitación que sigue libre (la misma fila), sin conflicto', async () => {
      const { service } = anApply();
      const before = aReservation();

      const plan = await service.prepare(
        before,
        aChange({ endDate: '2031-03-23' }),
      );

      expect(planned(plan, before)).toEqual([['conserva 201', 'DOBLE', 2]]);
      expect(plan.conflictReason).toBeNull();
    });

    it('si la suya ya no está libre, reasigna la libre de menor número', async () => {
      const { service } = anApply({ busy: [r201] });
      const before = aReservation();

      const plan = await service.prepare(before, aChange());

      expect(planned(plan, before)).toEqual([['202', 'DOBLE', 2]]);
      expect(plan.rooms[0].room).toEqual({
        roomId: r202.id,
        roomNumber: '202',
      });
      expect(plan.conflictReason).toBeNull();
    });

    it('si no hay ninguna libre, la deja sin asignar: NO_ROOM_AVAILABLE, sin rechazar el cambio', async () => {
      const { service } = anApply({ busy: [r201, r202, r203] });
      const before = aReservation();

      const plan = await service.prepare(before, aChange());

      expect(planned(plan, before)).toEqual([['sin asignar', 'DOBLE', 2]]);
      expect(plan.conflictReason).toBe('NO_ROOM_AVAILABLE');
    });

    it('una habitación agregada toma otra libre, sin repetir la conservada', async () => {
      const { service } = anApply();
      const before = aReservation();

      const plan = await service.prepare(
        before,
        aChange({
          rooms: [
            { categoryRoom: 'DOBLE', guestCount: 2 },
            { categoryRoom: 'DOBLE', guestCount: 1 },
          ],
        }),
      );

      expect(planned(plan, before)).toEqual([
        ['conserva 201', 'DOBLE', 2],
        ['202', 'DOBLE', 1],
      ]);
    });

    it('con dos de la misma categoría conserva primero la de menor número', async () => {
      const { service } = anApply();
      const before = aReservation({ rooms: [stayIn(r203), stayIn(r201)] });

      const plan = await service.prepare(
        before,
        aChange({
          rooms: [
            { categoryRoom: 'DOBLE', guestCount: 1 },
            { categoryRoom: 'DOBLE', guestCount: 2 },
          ],
        }),
      );

      expect(planned(plan, before)).toEqual([
        ['conserva 201', 'DOBLE', 1],
        ['conserva 203', 'DOBLE', 2],
      ]);
    });

    it('una habitación sin asignar de la reserva se asigna si ahora hay lugar', async () => {
      const { service } = anApply();
      const before = aReservation({ rooms: [stayIn(null)] });

      const plan = await service.prepare(before, aChange());

      expect(planned(plan, before)).toEqual([['201', 'DOBLE', 2]]);
      expect(plan.conflictReason).toBeNull();
    });

    it('más personas que la capacidad: CAPACITY_EXCEEDED, también en una conservada', async () => {
      const { service } = anApply();
      const before = aReservation();

      const plan = await service.prepare(
        before,
        aChange({ rooms: [{ categoryRoom: 'DOBLE', guestCount: 3 }] }),
      );

      expect(planned(plan, before)).toEqual([['conserva 201', 'DOBLE', 3]]);
      expect(plan.conflictReason).toBe('CAPACITY_EXCEEDED');
    });

    it('más personas que la capacidad en una reasignada: CAPACITY_EXCEEDED', async () => {
      const { service } = anApply({ busy: [r201, r202] });

      const plan = await service.prepare(
        aReservation(),
        aChange({ rooms: [{ categoryRoom: 'DOBLE', guestCount: 3 }] }),
      );

      expect(plan.rooms[0].room?.roomNumber).toBe('203');
      expect(plan.conflictReason).toBe('CAPACITY_EXCEEDED');
    });

    it('fechas distintas por habitación y sin otro motivo: CHANGE_NOT_APPLICABLE (FR-012)', async () => {
      const { service } = anApply();

      const plan = await service.prepare(
        aReservation(),
        aChange({ datesDifferPerRoom: true }),
      );

      expect(plan.conflictReason).toBe('CHANGE_NOT_APPLICABLE');
    });

    it('la capacidad va antes que las fechas distintas por habitación', async () => {
      const { service } = anApply();

      const plan = await service.prepare(
        aReservation(),
        aChange({
          rooms: [{ categoryRoom: 'DOBLE', guestCount: 3 }],
          datesDifferPerRoom: true,
        }),
      );

      expect(plan.conflictReason).toBe('CAPACITY_EXCEEDED');
    });

    it('sin asignar va antes que la capacidad', async () => {
      const { service } = anApply({ busy: [r305] });

      const plan = await service.prepare(
        aReservation(),
        aChange({
          rooms: [
            { categoryRoom: 'DOBLE', guestCount: 3 },
            { categoryRoom: 'SUITE', guestCount: 1 },
          ],
        }),
      );

      expect(plan.conflictReason).toBe('NO_ROOM_AVAILABLE');
    });

    it('si Booking cambió el valor, recalcula la comisión con el porcentaje congelado', async () => {
      const { service, recalculate } = anApply();
      const before = aReservation();

      const plan = await service.prepare(
        before,
        aChange({ grossAmount: Money.of('500', 'USD') }),
      );

      expect(recalculate).toHaveBeenCalledWith(before, Money.of('500', 'USD'));
      expect(plan.commission?.commissionAmount).toEqual(
        Money.of('75.00', 'USD'),
      );
    });

    it.each([
      ['el mismo valor', Money.of('400.00', 'USD'), false],
      ['otra moneda', Money.of('400', 'EUR'), true],
    ])('%s: recalcula %s', async (_case, grossAmount, recalculates) => {
      const { service, recalculate } = anApply();

      const plan = await service.prepare(
        aReservation(),
        aChange({ grossAmount }),
      );

      expect(recalculate).toHaveBeenCalledTimes(recalculates ? 1 : 0);
      expect(plan.commission === null).toBe(!recalculates);
    });
  });

  describe('apply: solo escribe, en la transacción de quien llama', () => {
    it('guarda la reserva cambiada sobre la bloqueada y avisa a la lista del día y a Channex', async () => {
      const before = aReservation();
      const { service, findForUpdate, update, record, ari, recordAudit } =
        anApply({
          locked: before,
        });
      const plan = await service.prepare(
        before,
        aChange({ startDate: '2031-03-21', endDate: '2031-03-24' }),
      );

      const saved = await service.apply(TX, plan);

      expect(findForUpdate).toHaveBeenCalledWith(TX, 'RSV-8D02E5A4');
      expect(update).toHaveBeenCalledWith(saved, TX);
      expect([saved.startDate, saved.endDate]).toEqual([
        '2031-03-21',
        '2031-03-24',
      ]);
      expect(saved.rooms[0].id).toBe(before.rooms[0].id);
      expect(saved.notes).toBe('Llega tarde');
      expect(saved.guest.snapshot()).toEqual({
        ...before.guest.snapshot(),
        firstName: 'John',
        lastName: 'Smith',
        contactEmail: 'john@correo.com',
        contactPhone: null,
        nationality: 'Estados Unidos',
      });
      expect(record).toHaveBeenCalledWith(TX, before, saved);
      // Lo que se libera en las fechas de antes y lo que se ocupa en las nuevas.
      expect(ari).toHaveBeenCalledWith(TX, [
        { categoryRoom: 'DOBLE', dateFrom: '2031-03-20', dateTo: '2031-03-22' },
        { categoryRoom: 'DOBLE', dateFrom: '2031-03-21', dateTo: '2031-03-24' },
      ]);
      // El valor no cambió: no hay auditoría.
      expect(recordAudit).not.toHaveBeenCalled();
    });

    it('sin cambiar de fechas ni de categoría, un solo aviso a Channex', async () => {
      const before = aReservation();
      const { service, ari } = anApply({ locked: before });

      await service.apply(TX, await service.prepare(before, aChange()));

      expect(ari).toHaveBeenCalledWith(TX, [
        { categoryRoom: 'DOBLE', dateFrom: '2031-03-20', dateTo: '2031-03-22' },
      ]);
    });

    it('con la comisión recalculada guarda el valor y el importe nuevos y deja la auditoría de Booking.com', async () => {
      const before = aReservation();
      const { service, recordAudit } = anApply({ locked: before });
      const plan = await service.prepare(
        before,
        aChange({ grossAmount: Money.of('500', 'USD') }),
      );

      const saved = await service.apply(TX, plan);

      expect(saved.ota?.grossAmount).toEqual(Money.of('500', 'USD'));
      expect(saved.ota?.commissionAmount).toEqual(Money.of('75.00', 'USD'));
      expect(saved.ota?.commissionPercentage).toBe('15');
      expect(recordAudit).toHaveBeenCalledWith(
        TX,
        saved.id,
        plan.commission,
        'Booking.com',
      );
    });

    it('sin lugar: guarda la habitación sin asignar y marca el conflicto con la hora del cambio', async () => {
      const before = aReservation();
      const { service } = anApply({ busy: [r201, r202, r203], locked: before });

      const saved = await service.apply(
        TX,
        await service.prepare(before, aChange()),
      );

      expect(saved.rooms[0].roomId).toBeNull();
      expect(saved.rooms[0].stayStatus).toBe('EXPECTED');
      expect(saved.conflict).toEqual({
        reason: 'NO_ROOM_AVAILABLE',
        detectedAt: NOW,
      });
    });

    it('con el mismo motivo de conflicto, conserva desde cuándo; si se resuelve, lo quita', async () => {
      const detectedAt = new Date('2031-03-01T10:00:00.000Z');
      const inConflict = aReservation({
        rooms: [stayIn(null)],
        conflict: { reason: 'NO_ROOM_AVAILABLE', detectedAt },
      });
      const still = anApply({ busy: [r201, r202, r203], locked: inConflict });
      const solved = anApply({ locked: inConflict });

      const stillSaved = await still.service.apply(
        TX,
        await still.service.prepare(inConflict, aChange()),
      );
      const solvedSaved = await solved.service.apply(
        TX,
        await solved.service.prepare(inConflict, aChange()),
      );

      expect(stillSaved.conflict).toEqual({
        reason: 'NO_ROOM_AVAILABLE',
        detectedAt,
      });
      expect(solvedSaved.conflict).toBeNull();
      expect(solvedSaved.rooms[0].roomNumber).toBe('201');
    });

    it('si la reserva cambió desde prepare: CONCURRENT_UPDATE, sin guardar ni avisar', async () => {
      const before = aReservation();
      const changed = aReservation({
        updatedAt: '2031-03-12 10:05:00.000001-05',
      });
      const { service, update, record, ari } = anApply({ locked: changed });

      await expect(
        service.apply(TX, await service.prepare(before, aChange())),
      ).rejects.toMatchObject({ errorCode: 'CONCURRENT_UPDATE' });
      expect(update).not.toHaveBeenCalled();
      expect(record).not.toHaveBeenCalled();
      expect(ari).not.toHaveBeenCalled();
    });

    it('si ya no existe: CONCURRENT_UPDATE', async () => {
      const before = aReservation();
      const { service } = anApply({ locked: null });

      const error: unknown = await service
        .apply(TX, await service.prepare(before, aChange()))
        .catch((thrown: unknown) => thrown);

      expect(error).toBeInstanceOf(BusinessError);
      expect(error).toMatchObject({ errorCode: 'CONCURRENT_UPDATE' });
    });

    it('un error de update sale tal cual, sin avisar', async () => {
      const before = aReservation();
      const { service, update, record } = anApply({ locked: before });
      update.mockRejectedValueOnce(new Error('se cayó la base'));

      await expect(
        service.apply(TX, await service.prepare(before, aChange())),
      ).rejects.toThrow('se cayó la base');
      expect(record).not.toHaveBeenCalled();
    });

    it('el titular conserva su documento: Booking no lo envía', async () => {
      const before = aReservation({
        guest: aGuest({ documentType: null, documentNumber: null }),
      });
      const { service } = anApply({ locked: before });

      const saved = await service.apply(
        TX,
        await service.prepare(before, aChange()),
      );

      expect(saved.guest.id).toBe(before.guest.id);
      expect([saved.guest.documentType, saved.guest.documentNumber]).toEqual([
        null,
        null,
      ]);
    });

    it('conserva la agencia, el código y el porcentaje de la reserva', async () => {
      const before = aReservation({
        ota: otaTerms(OTA_ID, { externalConfirmationCode: 'BK-1' }),
      });
      const { service } = anApply({ locked: before });

      const saved = await service.apply(
        TX,
        await service.prepare(before, aChange()),
      );

      expect(saved.ota).toEqual(before.ota);
    });
  });
});
