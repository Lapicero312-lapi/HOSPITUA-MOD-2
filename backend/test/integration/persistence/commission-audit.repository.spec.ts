import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CommissionAuditEntry } from '../../../src/application/ports/out/commission-audit.repository.js';
import type { Ota } from '../../../src/domain/ota/ota.js';
import type { Reservation } from '../../../src/domain/reservation/reservation.js';
import { Money } from '../../../src/domain/shared/money.js';
import { TypeOrmCommissionAuditRepository } from '../../../src/infrastructure/out/persistence/repositories/commission-audit.repository.js';
import { TypeOrmOtaRepository } from '../../../src/infrastructure/out/persistence/repositories/ota.repository.js';
import { TypeOrmReservationRepository } from '../../../src/infrastructure/out/persistence/repositories/reservation.repository.js';
import {
  managerFor,
  TypeOrmTransactionRunner,
} from '../../../src/infrastructure/out/persistence/typeorm-transaction.js';
import { anOta, anOtaReservation } from '../../support/builders.js';
import { openTestDataSource, truncateAllTables } from '../support/database.js';

/** Una fila de `commission_audit` tal como la guardó la base, sin pasar por `number` ni `Date`. */
type AuditRow = {
  id: string;
  reservation_id: string;
  ota_id: string;
  action: string;
  previous_status: string | null;
  gross_amount: string;
  commission_percentage: string;
  commission_amount: string;
  channel: string;
  performed_by: string;
  occurred_at: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('TypeOrmCommissionAuditRepository contra PostgreSQL real', () => {
  let dataSource: DataSource;
  let audits: TypeOrmCommissionAuditRepository;
  let transactions: TypeOrmTransactionRunner;
  let ota: Ota;
  let reservation: Reservation;

  /**
   * Por defecto, el cálculo del escenario 1 de la historia 1 del plan: agencia con 15 % y `grossAmount`
   * 400, comisión 60.00, canal `OTA_API` y `Booking.com` como autor (regla 6).
   */
  const aCalculation = (
    changes: Partial<CommissionAuditEntry> = {},
  ): CommissionAuditEntry => ({
    reservationId: reservation.id,
    otaId: ota.id,
    action: 'CALCULATED',
    previousStatus: null,
    grossAmount: Money.of('400.00', 'COP'),
    commissionPercentage: '15.00',
    commissionAmount: Money.of('60.00', 'COP'),
    channel: 'OTA_API',
    performedBy: 'Booking.com',
    ...changes,
  });

  /** La conciliación del escenario 1 de la historia 2: `CALCULATED` → `RECONCILED` por el Módulo 3. */
  const aReconciliation = (): CommissionAuditEntry =>
    aCalculation({
      action: 'RECONCILED',
      previousStatus: 'CALCULATED',
      channel: 'MODULE3',
      performedBy: 'MODULE3',
    });

  const record = (entry: CommissionAuditEntry) =>
    transactions.run((tx) => audits.record(entry, tx));

  const rows = (): Promise<AuditRow[]> =>
    dataSource.query(
      `SELECT id::text, reservation_id::text, ota_id::text, action, previous_status,
              gross_amount::text, commission_percentage::text, commission_amount::text,
              channel, performed_by, occurred_at::text
       FROM commission_audit ORDER BY occurred_at`,
    );

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    audits = new TypeOrmCommissionAuditRepository(dataSource);
    transactions = new TypeOrmTransactionRunner(dataSource);
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    ota = await new TypeOrmOtaRepository(dataSource).insert(anOta());
    reservation = await new TypeOrmReservationRepository(dataSource).insert(
      anOtaReservation(ota.id),
    );
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('historia 1, escenario 1: registra el cálculo con sus importes, el canal OTA_API y Booking.com', async () => {
    await record(aCalculation());

    const saved = await rows();
    expect(saved).toEqual([
      {
        id: expect.stringMatching(UUID) as string,
        reservation_id: reservation.id,
        ota_id: ota.id,
        action: 'CALCULATED',
        previous_status: null,
        gross_amount: '400.00',
        commission_percentage: '15.00',
        commission_amount: '60.00',
        channel: 'OTA_API',
        performed_by: 'Booking.com',
        occurred_at: expect.any(String) as string,
      },
    ]);
  });

  it('historia 2, escenario 1: registra la conciliación con el estado anterior, el canal MODULE3 y quién la hizo', async () => {
    await record(aReconciliation());

    expect(await rows()).toEqual([
      expect.objectContaining({
        action: 'RECONCILED',
        previous_status: 'CALCULATED',
        channel: 'MODULE3',
        performed_by: 'MODULE3',
      }),
    ]);
  });

  it('el pago desde RECONCILED también deja su fila', async () => {
    await record(
      aCalculation({
        action: 'PAID',
        previousStatus: 'RECONCILED',
        channel: 'MODULE3',
        performedBy: 'MODULE3',
      }),
    );

    expect(await rows()).toEqual([
      expect.objectContaining({
        action: 'PAID',
        previous_status: 'RECONCILED',
      }),
    ]);
  });

  it('la hora es la de la base al registrar (now() de la transacción de quien llama)', async () => {
    const transactionNow = await transactions.run(async (tx) => {
      await audits.record(aCalculation(), tx);
      const [{ now }]: { now: string }[] = await managerFor(
        dataSource,
        tx,
      ).query('SELECT now()::text AS now');
      return now;
    });

    expect((await rows())[0].occurred_at).toBe(transactionNow);
  });

  // Datos de NFR-002 del plan: se guardan tal como llegan, sin pasar por `number`.
  it.each([
    ['100.30', '15.00', '15.05'],
    ['100.10', '14.95', '14.96'],
    ['0.10', '15.00', '0.02'],
    ['250000.00', '100.00', '250000.00'],
    ['1000.00', '0.00', '0.00'],
  ])(
    'guarda exactos el valor bruto %s, el porcentaje %s y la comisión %s',
    async (gross, percentage, commission) => {
      await record(
        aCalculation({
          grossAmount: Money.of(gross, 'COP'),
          commissionPercentage: percentage,
          commissionAmount: Money.of(commission, 'COP'),
        }),
      );

      expect(await rows()).toEqual([
        expect.objectContaining({
          gross_amount: gross,
          commission_percentage: percentage,
          commission_amount: commission,
        }),
      ]);
    },
  );

  it('cada comisión deja su propia fila: el cálculo no cambia al registrar la conciliación', async () => {
    await record(aCalculation());
    const [calculation] = await rows();

    await record(aReconciliation());

    const saved = await rows();
    expect(saved).toHaveLength(2);
    expect(saved[0]).toEqual(calculation);
    expect(saved[1]).toMatchObject({
      action: 'RECONCILED',
      previous_status: 'CALCULATED',
    });
    expect(saved[1].id).not.toBe(calculation.id);
  });

  it('si la transacción de quien llama se revierte, la fila no queda', async () => {
    await expect(
      transactions.run(async (tx) => {
        await audits.record(aCalculation(), tx);
        throw new Error('falló el registro de la reserva');
      }),
    ).rejects.toThrow('falló el registro de la reserva');

    expect(await rows()).toHaveLength(0);
  });
});
