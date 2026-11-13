import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReservationQueryPort } from '../../../../../src/application/ports/out/reservation-query.port.js';
import type { ReservationRepository } from '../../../../../src/application/ports/out/reservation.repository.js';
import type {
  Transaction,
  TransactionRunner,
} from '../../../../../src/application/ports/out/transaction.js';
import type { DailyListChangeRecorder } from '../../../../../src/application/use-cases/check-view-reservation/ports/in/daily-list-change-recorder.port.js';
import type { OtaNoShowReporter } from '../../../../../src/application/use-cases/generate-ota-reservation/ports/in/ota-no-show-reporter.port.js';
import { CloseDayService } from '../../../../../src/application/use-cases/update-reservation/close-day.service.js';
import { ReservationStatusService } from '../../../../../src/application/use-cases/update-reservation/reservation-status.service.js';
import type {
  Reservation,
  ReservationProps,
} from '../../../../../src/domain/reservation/reservation.js';
import { BusinessError } from '../../../../../src/domain/shared/business-error.js';
import {
  aDirectReservation,
  aDirectRoom,
  aGuest,
  anOtaReservation,
  anOtaRoom,
} from '../../../../support/builders.js';
import type { IdempotencyKeyRepository } from '../../../../../src/application/ports/out/idempotency-key.repository.js';

/** El instante del cierre: las Idempotency-Key de antes de 24 horas ya vencieron. */
const NOW = new Date('2026-10-10T05:00:30.000Z');

/** El día que se cierra (el que terminó) y el siguiente. */
const DAY = '2026-10-09';
const NEXT = '2026-10-10';

const tx = { id: 'tx' } as unknown as Transaction;

/** Lo que el cierre deja en el log, por nivel. */
let warnings: string[];
let infos: string[];

/**
 * Las reservas en memoria, como las vería la base: `findToClose` y `findDaysToClose` las seleccionan con la
 * misma regla del repositorio, `lockByRef` las devuelve y `update` las guarda. El servicio de estados es el
 * real.
 */
function aClose(stored: Reservation[], batchSize = 100) {
  const byRef = new Map(stored.map((r) => [r.reservationRef, r]));
  const findToClose = vi.fn<ReservationQueryPort['findToClose']>(
    (operationalDate, afterRef, limit) =>
      Promise.resolve(
        [...byRef.values()]
          .filter(
            (r) =>
              r.startDate === operationalDate &&
              ['ACTIVE', 'PENDING', 'IN_PROGRESS'].includes(r.status) &&
              (afterRef === null || r.reservationRef > afterRef),
          )
          .map((r) => r.reservationRef)
          .sort()
          .slice(0, limit),
      ),
  );
  const findDaysToClose = vi.fn<ReservationQueryPort['findDaysToClose']>(
    (today) =>
      Promise.resolve(
        [
          ...new Set(
            [...byRef.values()]
              .filter(
                (r) =>
                  r.startDate < today &&
                  (['ACTIVE', 'PENDING'].includes(r.status) ||
                    (r.status === 'IN_PROGRESS' &&
                      r.rooms.some((room) => room.stayStatus === 'EXPECTED'))),
              )
              .map((r) => r.startDate),
          ),
        ].sort(),
      ),
  );
  const lockByRef = vi.fn((ref: string, _tx: Transaction) =>
    Promise.resolve(byRef.get(ref) ?? null),
  );
  const update = vi.fn((reservation: Reservation, _tx?: Transaction) => {
    byRef.set(reservation.reservationRef, reservation);
    return Promise.resolve(reservation);
  });
  const reservations = {
    lockByRef,
    update,
  } as unknown as ReservationRepository;
  const record = vi
    .fn<DailyListChangeRecorder['record']>()
    .mockResolvedValue(undefined);
  const reportNoShow = vi
    .fn<OtaNoShowReporter['record']>()
    .mockResolvedValue(undefined);
  const run = vi.fn(<T>(work: (tx: Transaction) => Promise<T>) => work(tx));
  const deleteExpired = vi
    .fn<IdempotencyKeyRepository['deleteExpired']>()
    .mockResolvedValue(0);
  const service = new CloseDayService(
    { findToClose, findDaysToClose } as unknown as ReservationQueryPort,
    reservations,
    new ReservationStatusService(reservations),
    { record },
    { record: reportNoShow },
    { run } as unknown as TransactionRunner,
    batchSize,
    { find: vi.fn(), save: vi.fn(), deleteExpired },
    { today: () => '2026-10-10', now: () => NOW },
  );
  return {
    service,
    deleteExpired,
    findToClose,
    findDaysToClose,
    update,
    record,
    reportNoShow,
    run,
    current: (ref: string) => byRef.get(ref),
  };
}

/** Una reserva directa que llega `DAY`. */
const arriving = (changes: Partial<ReservationProps> = {}) =>
  aDirectReservation({ startDate: DAY, endDate: '2026-10-11', ...changes });

describe('CloseDayService (plan de update-reservation, "Cierre del día", D5 y punto 13; T021 y T023)', () => {
  beforeEach(() => {
    warnings = [];
    infos = [];
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(
      (message: unknown) => {
        warnings.push(String(message));
      },
    );
    vi.spyOn(Logger.prototype, 'log').mockImplementation((message: unknown) => {
      infos.push(String(message));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('ACTIVE o PENDING: No-Show (FR-019 y FR-021)', () => {
    it.each(['ACTIVE', 'PENDING'] as const)(
      'una directa en %s pasa a NO_SHOW con DAY_CLOSE_NO_SHOW y todas sus habitaciones a NOT_ARRIVED, en su transacción',
      async (status) => {
        const reservation = arriving({
          status,
          rooms: [aDirectRoom(), aDirectRoom({ roomNumber: '202' })],
        });
        const { service, current, run } = aClose([reservation]);

        const summary = await service.execute(DAY);

        const after = current(reservation.reservationRef);
        expect(after?.status).toBe('NO_SHOW');
        expect(after?.statusReason).toBe('DAY_CLOSE_NO_SHOW');
        expect(after?.rooms.map((room) => room.stayStatus)).toEqual([
          'NOT_ARRIVED',
          'NOT_ARRIVED',
        ]);
        expect(run).toHaveBeenCalledTimes(1);
        expect(summary).toEqual({
          operationalDate: DAY,
          noShow: 1,
          notArrived: 0,
          completed: 0,
          ignored: 0,
          failed: 0,
        });
      },
    );

    it('avisa a la lista del día con la reserva antes y después, y con el día cerrado, no con el de hoy (T023)', async () => {
      const reservation = arriving();
      const { service, record, current } = aClose([reservation]);

      await service.execute(DAY);

      expect(record).toHaveBeenCalledExactlyOnceWith(
        tx,
        reservation,
        current(reservation.reservationRef),
        DAY,
      );
    });

    it('una directa no deja reporte de no-show', async () => {
      const { service, reportNoShow } = aClose([arriving()]);

      await service.execute(DAY);

      expect(reportNoShow).not.toHaveBeenCalled();
    });

    it('una de Booking deja pendiente el reporte del no-show en la misma transacción, con la reserva ya en NO_SHOW (FR-021)', async () => {
      const booking = anOtaReservation(randomUUID(), {
        startDate: DAY,
        endDate: '2026-10-11',
      });
      const { service, reportNoShow } = aClose([booking]);

      await service.execute(DAY);

      expect(reportNoShow).toHaveBeenCalledExactlyOnceWith(
        tx,
        expect.objectContaining({
          reservationRef: booking.reservationRef,
          status: 'NO_SHOW',
        }),
      );
    });

    it('una de Booking en conflicto con una habitación sin asignar también pasa a NO_SHOW con todas en NOT_ARRIVED', async () => {
      const booking = anOtaReservation(randomUUID(), {
        startDate: DAY,
        endDate: '2026-10-11',
        rooms: [anOtaRoom({ roomId: null, roomNumber: null })],
        conflict: { reason: 'NO_ROOM_AVAILABLE', detectedAt: new Date() },
      });
      const { service, current } = aClose([booking]);

      await service.execute(DAY);

      expect(current(booking.reservationRef)?.status).toBe('NO_SHOW');
      expect(
        current(booking.reservationRef)?.rooms.map((room) => room.stayStatus),
      ).toEqual(['NOT_ARRIVED']);
    });
  });

  describe('IN_PROGRESS: llegada parcial (FR-019)', () => {
    it('escenario 3: la habitación sin ingreso pasa a NOT_ARRIVED y la reserva sigue IN_PROGRESS, sin avisar a la lista', async () => {
      const reservation = arriving({
        status: 'IN_PROGRESS',
        statusReason: 'CHECK_IN',
        rooms: [
          aDirectRoom({ stayStatus: 'CHECKED_IN' }),
          aDirectRoom({ roomNumber: '202' }),
        ],
      });
      const { service, current, record, reportNoShow } = aClose([reservation]);

      const summary = await service.execute(DAY);

      const after = current(reservation.reservationRef);
      expect(after?.status).toBe('IN_PROGRESS');
      expect(after?.statusReason).toBe('CHECK_IN');
      expect(after?.rooms.map((room) => room.stayStatus)).toEqual([
        'CHECKED_IN',
        'NOT_ARRIVED',
      ]);
      expect(record).not.toHaveBeenCalled();
      expect(reportNoShow).not.toHaveBeenCalled();
      expect(summary).toMatchObject({ notArrived: 1, completed: 0 });
    });

    it('si ya no le queda ninguna CHECKED_IN, pasa a COMPLETED con DAY_CLOSE_PARTIAL', async () => {
      const reservation = arriving({
        status: 'IN_PROGRESS',
        statusReason: 'CHECK_IN',
        rooms: [
          aDirectRoom({ stayStatus: 'CHECKED_OUT' }),
          aDirectRoom({ roomNumber: '202' }),
        ],
      });
      const { service, current, record } = aClose([reservation]);

      const summary = await service.execute(DAY);

      const after = current(reservation.reservationRef);
      expect(after?.status).toBe('COMPLETED');
      expect(after?.statusReason).toBe('DAY_CLOSE_PARTIAL');
      expect(after?.rooms.map((room) => room.stayStatus)).toEqual([
        'CHECKED_OUT',
        'NOT_ARRIVED',
      ]);
      expect(record).not.toHaveBeenCalled();
      expect(summary).toMatchObject({ notArrived: 0, completed: 1 });
    });

    it('también pasa a NOT_ARRIVED una habitación sin asignar de una reserva de Booking en conflicto', async () => {
      const booking = anOtaReservation(randomUUID(), {
        startDate: DAY,
        endDate: '2026-10-11',
        status: 'IN_PROGRESS',
        statusReason: 'CHECK_IN',
        rooms: [
          anOtaRoom({ stayStatus: 'CHECKED_IN' }),
          anOtaRoom({ roomId: null, roomNumber: null }),
        ],
        conflict: { reason: 'NO_ROOM_AVAILABLE', detectedAt: new Date() },
      });
      const { service, current } = aClose([booking]);

      await service.execute(DAY);

      expect(
        current(booking.reservationRef)?.rooms.map((room) => room.stayStatus),
      ).toEqual(['CHECKED_IN', 'NOT_ARRIVED']);
    });

    it('escenario 4: con todas sus habitaciones ingresadas se ignora y no se guarda nada', async () => {
      const reservation = arriving({
        status: 'IN_PROGRESS',
        statusReason: 'CHECK_IN',
        rooms: [
          aDirectRoom({ stayStatus: 'CHECKED_IN' }),
          aDirectRoom({ stayStatus: 'CHECKED_OUT', roomNumber: '202' }),
        ],
      });
      const { service, update, current } = aClose([reservation]);

      const summary = await service.execute(DAY);

      expect(update).not.toHaveBeenCalled();
      expect(current(reservation.reservationRef)).toBe(reservation);
      expect(summary).toMatchObject({ ignored: 1 });
    });
  });

  describe('lo que cambió entre la selección y el bloqueo se ignora', () => {
    it('una reserva que ya no existe', async () => {
      const reservation = arriving();
      const { service, update } = aClose([reservation]);
      const findToClose = vi
        .fn<ReservationQueryPort['findToClose']>()
        .mockResolvedValueOnce(['RSV-00000000'])
        .mockResolvedValue([]);
      // Selecciona una referencia que el bloqueo ya no encuentra.
      Object.assign(service, {
        query: { findToClose },
      });

      const summary = await service.execute(DAY);

      expect(update).not.toHaveBeenCalled();
      expect(summary).toMatchObject({ ignored: 1, noShow: 0 });
    });

    it.each([
      ['cambió de fecha', { startDate: NEXT, endDate: '2026-10-12' }],
      ['ya está CANCELLED', { status: 'CANCELLED' as const }],
      ['ya está NO_SHOW', { status: 'NO_SHOW' as const }],
    ])('una que %s', async (_case, changes) => {
      const reservation = arriving();
      const { service, update, findToClose } = aClose([reservation]);
      // La selección la trae, pero al bloquearla ya cambió.
      findToClose
        .mockResolvedValueOnce([reservation.reservationRef])
        .mockResolvedValue([]);
      const changed = arriving({
        ...changes,
        id: reservation.id,
        reservationRef: reservation.reservationRef,
        rooms:
          'status' in changes && changes.status === 'NO_SHOW'
            ? [aDirectRoom({ stayStatus: 'NOT_ARRIVED' })]
            : [...reservation.rooms],
      });
      const locked = vi.fn().mockResolvedValue(changed);
      Object.assign(service, {
        reservations: { lockByRef: locked, update },
      });

      const summary = await service.execute(DAY);

      expect(update).not.toHaveBeenCalled();
      expect(summary).toMatchObject({ ignored: 1, noShow: 0 });
    });
  });

  describe('escenario 5: un fallo aislado no detiene el lote (FR-022)', () => {
    it('la reserva que falla se cuenta y se deja en el log con su referencia y el motivo, sin datos personales; las demás se cierran', async () => {
      const broken = anOtaReservation(randomUUID(), {
        startDate: DAY,
        endDate: '2026-10-11',
        guest: aGuest({ firstName: 'Valentina', lastName: 'Ospina' }),
      });
      const others = [arriving(), arriving()];
      const { service, reportNoShow, current } = aClose([broken, ...others]);
      reportNoShow.mockRejectedValueOnce(
        new Error(
          `La reserva ${broken.reservationRef} de Booking no tiene ninguna revisión: no se puede dejar pendiente el reporte de su no-show.`,
        ),
      );

      const summary = await service.execute(DAY);

      expect(summary).toMatchObject({ noShow: 2, failed: 1 });
      for (const other of others) {
        expect(current(other.reservationRef)?.status).toBe('NO_SHOW');
      }
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain(broken.reservationRef);
      expect(warnings[0]).toContain(DAY);
      expect(warnings[0]).toContain('no tiene ninguna revisión');
      expect(warnings[0]).not.toMatch(/Valentina|Ospina/);
    });

    it('el motivo de un error de negocio lleva su código', async () => {
      const reservation = arriving();
      const { service, update } = aClose([reservation]);
      update.mockRejectedValueOnce(
        new BusinessError(
          'CONCURRENT_UPDATE',
          'Esta reserva ya fue actualizada o cancelada recientemente',
        ),
      );

      const summary = await service.execute(DAY);

      expect(summary).toMatchObject({ failed: 1, noShow: 0 });
      expect(warnings[0]).toContain(
        'CONCURRENT_UPDATE: Esta reserva ya fue actualizada o cancelada recientemente',
      );
    });

    it('un error al seleccionar un lote detiene el cierre: lo maneja quien lo llama (CloseDayJob)', async () => {
      const { service, findToClose } = aClose([arriving()]);
      findToClose.mockRejectedValueOnce(
        new Error('la base de datos no responde'),
      );

      await expect(service.execute(DAY)).rejects.toThrow(
        'la base de datos no responde',
      );
    });
  });

  describe('por lotes de CLOSE_DAY_BATCH_SIZE', () => {
    it('cada lote empieza después de la última referencia del anterior, y termina con uno incompleto', async () => {
      const stored = Array.from({ length: 5 }, () =>
        arriving({
          status: 'IN_PROGRESS',
          rooms: [aDirectRoom({ stayStatus: 'CHECKED_IN' })],
        }),
      );
      const refs = stored.map((r) => r.reservationRef).sort();
      const { service, findToClose } = aClose(stored, 2);

      const summary = await service.execute(DAY);

      // Ninguna cambia (todas ingresaron): los lotes no se corren aunque sigan en la selección.
      expect(findToClose.mock.calls).toEqual([
        [DAY, null, 2],
        [DAY, refs[1], 2],
        [DAY, refs[3], 2],
      ]);
      expect(summary).toMatchObject({ ignored: 5 });
    });

    it('con un múltiplo exacto del lote pide uno más, que llega vacío', async () => {
      const stored = Array.from({ length: 4 }, () => arriving());
      const refs = stored.map((r) => r.reservationRef).sort();
      const { service, findToClose } = aClose(stored, 2);

      const summary = await service.execute(DAY);

      expect(findToClose.mock.calls).toEqual([
        [DAY, null, 2],
        [DAY, refs[1], 2],
        [DAY, refs[3], 2],
      ]);
      expect(summary).toMatchObject({ noShow: 4 });
    });

    it('sin reservas ese día, un solo lote vacío y el resumen en cero', async () => {
      const { service, findToClose, run } = aClose([
        arriving({ startDate: NEXT, endDate: '2026-10-12' }),
      ]);

      const summary = await service.execute(DAY);

      expect(findToClose).toHaveBeenCalledTimes(1);
      expect(run).not.toHaveBeenCalled();
      expect(summary).toEqual({
        operationalDate: DAY,
        noShow: 0,
        notArrived: 0,
        completed: 0,
        ignored: 0,
        failed: 0,
      });
    });
  });

  it('NFR-003: cerrar dos veces el mismo día no cambia nada la segunda vez', async () => {
    const stored = [
      arriving(),
      arriving({
        status: 'IN_PROGRESS',
        rooms: [
          aDirectRoom({ stayStatus: 'CHECKED_IN' }),
          aDirectRoom({ roomNumber: '202' }),
        ],
      }),
    ];
    const { service, update, record } = aClose(stored);

    await service.execute(DAY);
    update.mockClear();
    record.mockClear();
    const second = await service.execute(DAY);

    expect(update).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
    expect(second).toMatchObject({ noShow: 0, notArrived: 0, ignored: 1 });
  });

  it('deja el resumen en el log, solo con cifras', async () => {
    const { service } = aClose([
      arriving({
        guest: aGuest({ firstName: 'Valentina', lastName: 'Ospina' }),
      }),
    ]);

    await service.execute(DAY);

    expect(infos).toEqual([
      `Cierre del día ${DAY}: 1 No-Show, 0 con habitaciones sin llegar, 0 completadas, 0 ignoradas y 0 con error.`,
    ]);
  });
  describe('closePendingDays: los días que quedaron sin cerrar (punto 14; T022)', () => {
    /** Una reserva directa que llega ese día. */
    const arrivingOn = (
      startDate: string,
      changes: Partial<ReservationProps> = {},
    ) => aDirectReservation({ startDate, endDate: '2026-10-20', ...changes });

    it('cierra cada día anterior a hoy que tiene algo pendiente, del más antiguo al más reciente, y nunca hoy', async () => {
      const older = arrivingOn('2026-10-07');
      const yesterday = arrivingOn(DAY);
      const today = arrivingOn(NEXT);
      const { service, findDaysToClose, findToClose, current } = aClose([
        yesterday,
        today,
        older,
      ]);

      const summaries = await service.closePendingDays(NEXT);

      expect(findDaysToClose).toHaveBeenCalledExactlyOnceWith(NEXT);
      expect(summaries).toEqual([
        {
          operationalDate: '2026-10-07',
          noShow: 1,
          notArrived: 0,
          completed: 0,
          ignored: 0,
          failed: 0,
        },
        {
          operationalDate: DAY,
          noShow: 1,
          notArrived: 0,
          completed: 0,
          ignored: 0,
          failed: 0,
        },
      ]);
      // Un lote menor que CLOSE_DAY_BATCH_SIZE termina el día: una selección por día.
      expect(findToClose.mock.calls.map(([day]) => day)).toEqual([
        '2026-10-07',
        DAY,
      ]);
      expect(current(older.reservationRef)?.status).toBe('NO_SHOW');
      expect(current(yesterday.reservationRef)?.status).toBe('NO_SHOW');
      expect(current(today.reservationRef)?.status).toBe('ACTIVE');
    });

    it('cada día lleva su propia fecha al aviso de la lista (T023)', async () => {
      const older = arrivingOn('2026-10-07');
      const yesterday = arrivingOn(DAY);
      const { service, record } = aClose([older, yesterday]);

      await service.closePendingDays(NEXT);

      expect(record.mock.calls.map((call) => call[3])).toEqual([
        '2026-10-07',
        DAY,
      ]);
    });

    it('sin días pendientes no selecciona ninguna reserva y devuelve una lista vacía', async () => {
      const { service, findToClose, update } = aClose([arrivingOn(NEXT)]);

      await expect(service.closePendingDays(NEXT)).resolves.toEqual([]);
      expect(findToClose).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    });

    it('si un día se detiene por la base de datos, lanza y no sigue con los siguientes', async () => {
      const older = arrivingOn('2026-10-07');
      const yesterday = arrivingOn(DAY);
      const { service, findToClose, current } = aClose([older, yesterday]);
      findToClose.mockRejectedValueOnce(new Error('Connection terminated'));

      await expect(service.closePendingDays(NEXT)).rejects.toThrow(
        'Connection terminated',
      );
      expect(findToClose.mock.calls.map(([day]) => day)).toEqual([
        '2026-10-07',
      ]);
      expect(current(older.reservationRef)?.status).toBe('ACTIVE');
      expect(current(yesterday.reservationRef)?.status).toBe('ACTIVE');
    });

    it('la segunda vez ya no encuentra días pendientes (NFR-003)', async () => {
      const { service, update } = aClose([
        arrivingOn('2026-10-07'),
        arrivingOn(DAY),
      ]);

      await service.closePendingDays(NEXT);
      update.mockClear();

      await expect(service.closePendingDays(NEXT)).resolves.toEqual([]);
      expect(update).not.toHaveBeenCalled();
    });
  });

  describe('el borrado de las Idempotency-Key vencidas (T019 de generate-direct-reservation)', () => {
    it('al terminar, borra las de antes de 24 horas', async () => {
      const { service, deleteExpired } = aClose([]);

      await service.execute('2026-10-09');

      expect(deleteExpired).toHaveBeenCalledExactlyOnceWith(
        new Date('2026-10-09T05:00:30.000Z'),
      );
    });

    it('si el borrado falla, el cierre termina igual y devuelve su resumen', async () => {
      const { service, deleteExpired } = aClose([]);
      deleteExpired.mockRejectedValue(new Error('se cayó la conexión'));

      await expect(service.execute('2026-10-09')).resolves.toMatchObject({
        operationalDate: '2026-10-09',
      });
    });
  });
});
