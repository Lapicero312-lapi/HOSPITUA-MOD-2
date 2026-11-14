import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CommissionAuditEntry,
  CommissionAuditRepository,
} from '../../../../../src/application/ports/out/commission-audit.repository.js';
import type { ReservationRepository } from '../../../../../src/application/ports/out/reservation.repository.js';
import type {
  Transaction,
  TransactionRunner,
} from '../../../../../src/application/ports/out/transaction.js';
import type {
  ReconciliationItem,
  ReconciliationItemResult,
} from '../../../../../src/application/use-cases/register-ota-information-commission/ports/in/reconcile-commissions.port.js';
import { ReconcileCommissionsService } from '../../../../../src/application/use-cases/register-ota-information-commission/reconcile-commissions.service.js';
import type { Reservation } from '../../../../../src/domain/reservation/reservation.js';
import type {
  CommissionStatus,
  ReservationStatus,
} from '../../../../../src/domain/shared/enums.js';
import { Money } from '../../../../../src/domain/shared/money.js';
import {
  aDirectReservation,
  anOtaReservation,
  anOtaRoom,
  otaTerms,
} from '../../../../support/builders.js';

const OTA_ID = randomUUID();

/** El ejemplo de A2: una reserva `COMPLETED` de 400 USD con 15 % (60 USD) en `CALCULATED`. */
function completed(
  changes: {
    status?: ReservationStatus;
    commissionStatus?: CommissionStatus;
  } = {},
): Reservation {
  return anOtaReservation(OTA_ID, {
    status: changes.status ?? 'COMPLETED',
    rooms: [anOtaRoom({ stayStatus: 'CHECKED_OUT' })],
    ota: otaTerms(OTA_ID, {
      commissionStatus: changes.commissionStatus ?? 'CALCULATED',
    }),
  });
}

/** El ítem que concilió el Módulo 3 para `reservation`: sus mismos importes. */
function itemOf(
  reservation: Reservation,
  changes: Partial<ReconciliationItem> = {},
): ReconciliationItem {
  return {
    reservationRef: reservation.reservationRef,
    grossAmount: '400.00',
    commissionAmount: '60.00',
    ...changes,
  };
}

/**
 * El servicio con repositorios que guardan en un mapa (lo que se actualiza se ve en la siguiente lectura) y
 * un `TransactionRunner` que cuenta las transacciones y entrega la misma `tx` a todo lo que se hace dentro.
 */
function build(stored: Reservation[]) {
  const store = new Map(stored.map((r) => [r.reservationRef, r]));
  const tx = { id: 'tx' } as unknown as Transaction;
  const lockByRef = vi.fn((ref: string) =>
    Promise.resolve(store.get(ref) ?? null),
  );
  const update = vi.fn((reservation: Reservation) => {
    store.set(reservation.reservationRef, reservation);
    return Promise.resolve(reservation);
  });
  const record = vi.fn(() => Promise.resolve());
  const run = vi.fn(<T>(work: (tx: Transaction) => Promise<T>) => work(tx));
  const service = new ReconcileCommissionsService(
    { lockByRef, update } as unknown as ReservationRepository,
    { record } as unknown as CommissionAuditRepository,
    { run } as unknown as TransactionRunner,
  );
  return { service, store, tx, lockByRef, update, record, run };
}

/** Las filas de auditoría que se pidieron, sin la `tx`. */
function audits(record: ReturnType<typeof vi.fn>): CommissionAuditEntry[] {
  return (record.mock.calls as unknown as [CommissionAuditEntry][]).map(
    ([entry]) => entry,
  );
}

describe('ReconcileCommissionsService.execute (C.2 del plan de register-ota-information-commission)', () => {
  let error: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('APPLIED (caso 9)', () => {
    it('concilia una reserva COMPLETED con los montos que coinciden (historia 2, escenario 1)', async () => {
      const reservation = completed();
      const s = build([reservation]);

      const outcome = await s.service.execute('RECONCILED', [
        itemOf(reservation),
      ]);

      expect(outcome).toEqual({
        action: 'RECONCILED',
        results: [
          {
            reservationRef: reservation.reservationRef,
            result: 'APPLIED',
            commissionStatus: 'RECONCILED',
            reason: null,
          },
        ],
        summary: { applied: 1, alreadyApplied: 0, rejected: 0 },
      });
      expect(
        s.store.get(reservation.reservationRef)?.ota?.commissionStatus,
      ).toBe('RECONCILED');
    });

    it('guarda solo el estado: los importes, el porcentaje y el status de la reserva no cambian', async () => {
      const reservation = completed();
      const s = build([reservation]);

      await s.service.execute('PAID', [itemOf(reservation)]);

      const saved = s.update.mock.calls[0]?.[0] as Reservation;
      expect(saved.ota?.commissionStatus).toBe('PAID');
      expect(saved.ota?.commissionAmount.equals(Money.of('60', 'USD'))).toBe(
        true,
      );
      expect(saved.ota?.grossAmount.equals(Money.of('400', 'USD'))).toBe(true);
      expect(saved.ota?.commissionPercentage).toBe('15');
      expect(saved.status).toBe('COMPLETED');
    });

    it.each([
      ['CALCULATED', 'RECONCILED'],
      ['CALCULATED', 'PAID'],
      ['RECONCILED', 'PAID'],
    ] as const)('aplica la transición %s a %s', async (from, action) => {
      const reservation = completed({ commissionStatus: from });
      const s = build([reservation]);

      const { results } = await s.service.execute(action, [
        itemOf(reservation),
      ]);

      expect(results[0]).toMatchObject({
        result: 'APPLIED',
        commissionStatus: action,
        reason: null,
      });
    });

    it('deja una fila de auditoría con el canal y el usuario MODULE3, el estado anterior y los importes de la reserva', async () => {
      const reservation = completed();
      const s = build([reservation]);

      await s.service.execute('RECONCILED', [itemOf(reservation)]);

      expect(s.record).toHaveBeenCalledTimes(1);
      expect(s.record).toHaveBeenCalledWith(expect.any(Object), s.tx);
      const [entry] = audits(s.record);
      expect(entry).toMatchObject({
        reservationId: reservation.id,
        otaId: OTA_ID,
        action: 'RECONCILED',
        previousStatus: 'CALCULATED',
        commissionPercentage: '15',
        channel: 'MODULE3',
        performedBy: 'MODULE3',
      });
      expect(entry?.grossAmount.equals(Money.of('400', 'USD'))).toBe(true);
      expect(entry?.commissionAmount.equals(Money.of('60', 'USD'))).toBe(true);
    });

    it('la auditoría de RECONCILED a PAID lleva RECONCILED como estado anterior', async () => {
      const reservation = completed({ commissionStatus: 'RECONCILED' });
      const s = build([reservation]);

      await s.service.execute('PAID', [itemOf(reservation)]);

      expect(audits(s.record)[0]).toMatchObject({
        action: 'PAID',
        previousStatus: 'RECONCILED',
      });
    });

    it('el guardado y la auditoría van en la misma transacción que el bloqueo de la reserva', async () => {
      const reservation = completed();
      const s = build([reservation]);

      await s.service.execute('RECONCILED', [itemOf(reservation)]);

      expect(s.lockByRef).toHaveBeenCalledWith(
        reservation.reservationRef,
        s.tx,
      );
      expect(s.update).toHaveBeenCalledWith(expect.anything(), s.tx);
      expect(s.record).toHaveBeenCalledWith(expect.anything(), s.tx);
    });

    it.each([
      ['sin decimales', '400', '60'],
      ['con un decimal', '400.0', '60.0'],
      ['con dos decimales', '400.00', '60.00'],
    ])(
      'los montos %s valen lo mismo que los guardados',
      async (_, gross, commission) => {
        const reservation = completed();
        const s = build([reservation]);

        const { results } = await s.service.execute('RECONCILED', [
          itemOf(reservation, {
            grossAmount: gross,
            commissionAmount: commission,
          }),
        ]);

        expect(results[0]?.result).toBe('APPLIED');
      },
    );
  });

  describe('ALREADY_APPLIED (caso 7): el reenvío es idempotente', () => {
    it.each([
      ['RECONCILED', 'RECONCILED'],
      ['PAID', 'PAID'],
    ] as const)(
      'una comisión que ya está en %s, conciliada como %s, no cambia nada ni deja auditoría',
      async (current, action) => {
        const reservation = completed({ commissionStatus: current });
        const s = build([reservation]);

        const outcome = await s.service.execute(action, [itemOf(reservation)]);

        expect(outcome.results[0]).toEqual({
          reservationRef: reservation.reservationRef,
          result: 'ALREADY_APPLIED',
          commissionStatus: current,
          reason: null,
        });
        expect(outcome.summary).toEqual({
          applied: 0,
          alreadyApplied: 1,
          rejected: 0,
        });
        expect(s.update).not.toHaveBeenCalled();
        expect(s.record).not.toHaveBeenCalled();
      },
    );

    it('la misma conciliación enviada dos veces: APPLIED y luego ALREADY_APPLIED, con una sola auditoría', async () => {
      const reservation = completed();
      const s = build([reservation]);
      const request = [itemOf(reservation)];

      const first = await s.service.execute('RECONCILED', request);
      const second = await s.service.execute('RECONCILED', request);

      expect(first.results[0]?.result).toBe('APPLIED');
      expect(second.results[0]?.result).toBe('ALREADY_APPLIED');
      expect(s.update).toHaveBeenCalledTimes(1);
      expect(s.record).toHaveBeenCalledTimes(1);
    });

    it('la misma referencia dos veces en una solicitud: la segunda ya estaba aplicada', async () => {
      const reservation = completed();
      const s = build([reservation]);

      const { results, summary } = await s.service.execute('RECONCILED', [
        itemOf(reservation),
        itemOf(reservation),
      ]);

      expect(results.map(({ result }) => result)).toEqual([
        'APPLIED',
        'ALREADY_APPLIED',
      ]);
      expect(summary).toEqual({ applied: 1, alreadyApplied: 1, rejected: 0 });
    });
  });

  describe('REJECTED', () => {
    it('RESERVATION_NOT_FOUND si la referencia no existe, con commissionStatus en null', async () => {
      const s = build([]);
      const missing = {
        ...itemOf(completed()),
        reservationRef: 'RSV-00000000',
      };

      const { results, summary } = await s.service.execute('RECONCILED', [
        missing,
      ]);

      expect(results).toEqual([
        {
          reservationRef: 'RSV-00000000',
          result: 'REJECTED',
          commissionStatus: null,
          reason: 'RESERVATION_NOT_FOUND',
        },
      ]);
      expect(summary.rejected).toBe(1);
      expect(s.update).not.toHaveBeenCalled();
      expect(s.record).not.toHaveBeenCalled();
    });

    it('NOT_OTA_RESERVATION si es una reserva directa, con commissionStatus en null', async () => {
      const direct = aDirectReservation({ status: 'COMPLETED' });
      const s = build([direct]);

      const { results } = await s.service.execute('RECONCILED', [
        itemOf(direct),
      ]);

      expect(results[0]).toEqual({
        reservationRef: direct.reservationRef,
        result: 'REJECTED',
        commissionStatus: null,
        reason: 'NOT_OTA_RESERVATION',
      });
      expect(s.update).not.toHaveBeenCalled();
    });

    it('RESERVATION_CANCELLED si Booking la canceló, y su comisión no cambia (historia 2, escenario 2)', async () => {
      const cancelled = completed({ status: 'CANCELLED' });
      const s = build([cancelled]);

      const { results } = await s.service.execute('RECONCILED', [
        itemOf(cancelled),
      ]);

      expect(results[0]).toMatchObject({
        result: 'REJECTED',
        commissionStatus: 'CALCULATED',
        reason: 'RESERVATION_CANCELLED',
      });
      expect(s.update).not.toHaveBeenCalled();
      expect(s.record).not.toHaveBeenCalled();
      expect(
        s.store.get(cancelled.reservationRef)?.ota?.commissionAmount.amount,
      ).toBe('60');
    });

    it('RESERVATION_NO_SHOW si quedó en no-show, y su comisión no cambia (historia 2, escenario 3)', async () => {
      const noShow = completed({ status: 'NO_SHOW' });
      const s = build([noShow]);

      const { results } = await s.service.execute('PAID', [itemOf(noShow)]);

      expect(results[0]).toMatchObject({
        result: 'REJECTED',
        commissionStatus: 'CALCULATED',
        reason: 'RESERVATION_NO_SHOW',
      });
      expect(s.update).not.toHaveBeenCalled();
      expect(s.record).not.toHaveBeenCalled();
    });

    it.each(['PENDING', 'ACTIVE', 'IN_PROGRESS'] as const)(
      'RESERVATION_NOT_COMPLETED si la reserva está %s',
      async (status) => {
        const reservation = completed({ status });
        const s = build([reservation]);

        const { results } = await s.service.execute('RECONCILED', [
          itemOf(reservation),
        ]);

        expect(results[0]).toMatchObject({
          result: 'REJECTED',
          commissionStatus: 'CALCULATED',
          reason: 'RESERVATION_NOT_COMPLETED',
        });
        expect(s.update).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['el grossAmount', { grossAmount: '401.00' }],
      ['el commissionAmount', { commissionAmount: '60.01' }],
      ['los dos', { grossAmount: '1.00', commissionAmount: '1.00' }],
    ])('AMOUNT_MISMATCH si no coincide %s', async (_, wrong) => {
      const reservation = completed();
      const s = build([reservation]);

      const { results } = await s.service.execute('RECONCILED', [
        itemOf(reservation, wrong),
      ]);

      expect(results[0]).toMatchObject({
        result: 'REJECTED',
        commissionStatus: 'CALCULATED',
        reason: 'AMOUNT_MISMATCH',
      });
      expect(s.update).not.toHaveBeenCalled();
      expect(s.record).not.toHaveBeenCalled();
    });

    it('INVALID_TRANSITION si la comisión ya está PAID y se pide RECONCILED, y devuelve el estado actual', async () => {
      const reservation = completed({ commissionStatus: 'PAID' });
      const s = build([reservation]);

      const { results } = await s.service.execute('RECONCILED', [
        itemOf(reservation),
      ]);

      expect(results[0]).toEqual({
        reservationRef: reservation.reservationRef,
        result: 'REJECTED',
        commissionStatus: 'PAID',
        reason: 'INVALID_TRANSITION',
      });
      expect(s.update).not.toHaveBeenCalled();
      expect(s.record).not.toHaveBeenCalled();
    });
  });

  describe('el orden de los casos: el primero que se cumple da el resultado', () => {
    it('una reserva cancelada con montos distintos se rechaza por RESERVATION_CANCELLED, no por AMOUNT_MISMATCH', async () => {
      const cancelled = completed({ status: 'CANCELLED' });
      const s = build([cancelled]);

      const { results } = await s.service.execute('RECONCILED', [
        itemOf(cancelled, { grossAmount: '1.00' }),
      ]);

      expect(results[0]?.reason).toBe('RESERVATION_CANCELLED');
    });

    it('una reserva sin completar con montos distintos se rechaza por RESERVATION_NOT_COMPLETED', async () => {
      const active = completed({ status: 'ACTIVE' });
      const s = build([active]);

      const { results } = await s.service.execute('RECONCILED', [
        itemOf(active, { grossAmount: '1.00' }),
      ]);

      expect(results[0]?.reason).toBe('RESERVATION_NOT_COMPLETED');
    });

    it('los montos distintos se rechazan por AMOUNT_MISMATCH aunque la comisión ya estuviera aplicada', async () => {
      const reservation = completed({ commissionStatus: 'RECONCILED' });
      const s = build([reservation]);

      const { results } = await s.service.execute('RECONCILED', [
        itemOf(reservation, { commissionAmount: '1.00' }),
      ]);

      expect(results[0]?.reason).toBe('AMOUNT_MISMATCH');
    });

    it('ALREADY_APPLIED va antes que INVALID_TRANSITION: PAID conciliada como PAID es un reenvío', async () => {
      const reservation = completed({ commissionStatus: 'PAID' });
      const s = build([reservation]);

      const { results } = await s.service.execute('PAID', [
        itemOf(reservation),
      ]);

      expect(results[0]?.result).toBe('ALREADY_APPLIED');
    });
  });

  describe('cada ítem va por separado', () => {
    it('un ítem rechazado no impide los demás, y los resultados salen en el orden recibido, con su resumen', async () => {
      const good = completed();
      const cancelled = completed({ status: 'CANCELLED' });
      const another = completed({ commissionStatus: 'RECONCILED' });
      const s = build([good, cancelled, another]);

      const outcome = await s.service.execute('RECONCILED', [
        itemOf(cancelled),
        itemOf(good),
        { ...itemOf(good), reservationRef: 'RSV-00000000' },
        itemOf(another),
      ]);

      expect(
        outcome.results.map(({ reservationRef, result, reason }) => [
          reservationRef,
          result,
          reason,
        ]),
      ).toEqual([
        [cancelled.reservationRef, 'REJECTED', 'RESERVATION_CANCELLED'],
        [good.reservationRef, 'APPLIED', null],
        ['RSV-00000000', 'REJECTED', 'RESERVATION_NOT_FOUND'],
        [another.reservationRef, 'ALREADY_APPLIED', null],
      ]);
      expect(outcome.summary).toEqual({
        applied: 1,
        alreadyApplied: 1,
        rejected: 2,
      });
    });

    it('cada ítem abre su propia transacción', async () => {
      const a = completed();
      const b = completed();
      const c = completed({ status: 'CANCELLED' });
      const s = build([a, b, c]);

      await s.service.execute('RECONCILED', [itemOf(a), itemOf(b), itemOf(c)]);

      expect(s.run).toHaveBeenCalledTimes(3);
    });

    it('un error inesperado deja ese ítem en REQUEST_NOT_PROCESSED y los demás se procesan', async () => {
      const a = completed();
      const b = completed();
      const c = completed();
      const s = build([a, b, c]);
      s.update.mockImplementationOnce((reservation: Reservation) => {
        s.store.set(reservation.reservationRef, reservation);
        return Promise.resolve(reservation);
      });
      s.update.mockRejectedValueOnce(new Error('la base no responde'));

      const outcome = await s.service.execute('RECONCILED', [
        itemOf(a),
        itemOf(b),
        itemOf(c),
      ]);

      expect(outcome.results[0]?.result).toBe('APPLIED');
      expect(outcome.results[1]).toEqual({
        reservationRef: b.reservationRef,
        result: 'REJECTED',
        commissionStatus: null,
        reason: 'REQUEST_NOT_PROCESSED',
      });
      expect(outcome.results[2]?.result).toBe('APPLIED');
      expect(outcome.summary).toEqual({
        applied: 2,
        alreadyApplied: 0,
        rejected: 1,
      });
    });

    it('si la auditoría falla, el ítem sale REQUEST_NOT_PROCESSED', async () => {
      const reservation = completed();
      const s = build([reservation]);
      s.record.mockRejectedValueOnce(new Error('sin espacio'));

      const { results } = await s.service.execute('RECONCILED', [
        itemOf(reservation),
      ]);

      expect(results[0]).toMatchObject({
        result: 'REJECTED',
        reason: 'REQUEST_NOT_PROCESSED',
      });
    });

    it('registra el error con la referencia de la reserva y sin datos personales', async () => {
      const reservation = completed();
      const s = build([reservation]);
      s.lockByRef.mockRejectedValueOnce(new Error('la base no responde'));

      await s.service.execute('RECONCILED', [itemOf(reservation)]);

      expect(error).toHaveBeenCalledTimes(1);
      const message = error.mock.calls[0]?.[0] as string;
      expect(message).toContain(reservation.reservationRef);
      expect(message).not.toContain(reservation.guest.firstName);
      expect(message).not.toContain(reservation.guest.lastName);
    });
  });

  it('no concilia nada con una lista vacía: resultados y resumen en cero', async () => {
    const s = build([]);

    await expect(s.service.execute('PAID', [])).resolves.toEqual({
      action: 'PAID',
      results: [] as ReconciliationItemResult[],
      summary: { applied: 0, alreadyApplied: 0, rejected: 0 },
    });
    expect(s.run).not.toHaveBeenCalled();
  });
});
