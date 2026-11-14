import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CommissionResult } from '../../../../src/application/use-cases/register-ota-information-commission/ports/in/register-ota-confirmation-and-commission.port.js';
import { RegisterOtaConfirmationAndCommissionService } from '../../../../src/application/use-cases/register-ota-information-commission/register-ota-confirmation-and-commission.service.js';
import type { Ota } from '../../../../src/domain/ota/ota.js';
import type { Reservation } from '../../../../src/domain/reservation/reservation.js';
import { Money } from '../../../../src/domain/shared/money.js';
import { TypeOrmCommissionAuditRepository } from '../../../../src/infrastructure/out/persistence/repositories/commission-audit.repository.js';
import { TypeOrmOtaRepository } from '../../../../src/infrastructure/out/persistence/repositories/ota.repository.js';
import { TypeOrmReservationRepository } from '../../../../src/infrastructure/out/persistence/repositories/reservation.repository.js';
import { TypeOrmTransactionRunner } from '../../../../src/infrastructure/out/persistence/typeorm-transaction.js';
import {
  anOta,
  anOtaReservation,
  otaTerms,
} from '../../../support/builders.js';
import {
  openTestDataSource,
  truncateAllTables,
} from '../../support/database.js';

const usd = (amount: string) => Money.of(amount, 'USD');

/** Una fila de `commission_audit` tal como la guardó la base, sin pasar por `number`. */
type AuditRow = {
  reservation_id: string;
  ota_id: string;
  action: string;
  previous_status: string | null;
  gross_amount: string;
  commission_percentage: string;
  commission_amount: string;
  channel: string;
  performed_by: string;
};

/**
 * `recordAudit` con los repositorios reales (plan de `register-ota-information-commission`, B1 y D1): quien
 * llama calcula, guarda la reserva con su comisión y registra la auditoría, todo en su transacción.
 */
describe('RegisterOtaConfirmationAndCommission.recordAudit contra PostgreSQL real', () => {
  let dataSource: DataSource;
  let reservations: TypeOrmReservationRepository;
  let transactions: TypeOrmTransactionRunner;
  let service: RegisterOtaConfirmationAndCommissionService;

  const rows = (): Promise<AuditRow[]> =>
    dataSource.query(
      `SELECT reservation_id::text, ota_id::text, action, previous_status, gross_amount::text,
              commission_percentage::text, commission_amount::text, channel, performed_by
       FROM commission_audit ORDER BY occurred_at`,
    );

  /** La reserva de Booking de 400 con la comisión que dio `calculate`. */
  const aReservationWith = (ota: Ota, result: CommissionResult): Reservation =>
    anOtaReservation(ota.id, {
      ota: otaTerms(ota.id, {
        grossAmount: usd('400.00'),
        commissionPercentage: result.commissionPercentage,
        commissionAmount: result.commissionAmount,
      }),
    });

  /** D1: calcula, guarda la reserva y registra la auditoría en una sola transacción. */
  async function registerBookingReservation(ota: Ota): Promise<Reservation> {
    const result = await service.calculate({
      otaId: ota.id,
      grossAmount: usd('400.00'),
      reportedCommission: usd('60.00'),
      externalConfirmationCode: '4417829013',
    });
    return transactions.run(async (tx) => {
      const saved = await reservations.insert(
        aReservationWith(ota, result),
        tx,
      );
      await service.recordAudit(tx, saved.id, result, 'Booking.com');
      return saved;
    });
  }

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    reservations = new TypeOrmReservationRepository(dataSource);
    transactions = new TypeOrmTransactionRunner(dataSource);
    service = new RegisterOtaConfirmationAndCommissionService(
      new TypeOrmOtaRepository(dataSource),
      reservations,
      new TypeOrmCommissionAuditRepository(dataSource),
    );
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('historia 1, escenario 1: la comisión de 400 al 15 % deja su fila CALCULATED, sin estado anterior, por OTA_API y Booking.com', async () => {
    const ota = await new TypeOrmOtaRepository(dataSource).insert(
      anOta({ commissionPercentage: '15.00' }),
    );

    const reservation = await registerBookingReservation(ota);

    expect(await rows()).toEqual([
      {
        reservation_id: reservation.id,
        ota_id: ota.id,
        action: 'CALCULATED',
        previous_status: null,
        gross_amount: '400.00',
        commission_percentage: '15.00',
        commission_amount: '60.00',
        channel: 'OTA_API',
        performed_by: 'Booking.com',
      },
    ]);
  });

  it('historia 1, escenario 2: la primera reserva de la agencia audita el porcentaje calculado con ella', async () => {
    const ota = await new TypeOrmOtaRepository(dataSource).insert(
      anOta({ commissionPercentage: null }),
    );

    await registerBookingReservation(ota);

    expect(await rows()).toMatchObject([
      {
        previous_status: null,
        gross_amount: '400.00',
        commission_percentage: '15.00',
        commission_amount: '60.00',
      },
    ]);
  });

  it('una recalculación de la misma reserva deja otra fila con el estado anterior CALCULATED y conserva la primera', async () => {
    const ota = await new TypeOrmOtaRepository(dataSource).insert(anOta());
    const reservation = await registerBookingReservation(ota);
    const [first] = await rows();

    await transactions.run((tx) =>
      service.recordAudit(
        tx,
        reservation.id,
        {
          otaId: ota.id,
          commissionPercentage: '15',
          learnedPercentage: false,
          commissionAmount: usd('60.00'),
          commissionStatus: 'CALCULATED',
        },
        'Booking.com',
      ),
    );

    const saved = await rows();
    expect(saved).toHaveLength(2);
    expect(saved[0]).toEqual(first);
    expect(saved[1]).toMatchObject({
      action: 'CALCULATED',
      previous_status: 'CALCULATED',
    });
  });

  it('si la transacción de quien llama se revierte después de auditar, no quedan ni la reserva ni la fila', async () => {
    const ota = await new TypeOrmOtaRepository(dataSource).insert(anOta());
    const result = await service.calculate({
      otaId: ota.id,
      grossAmount: usd('400.00'),
      reportedCommission: usd('60.00'),
      externalConfirmationCode: '4417829013',
    });

    await expect(
      transactions.run(async (tx) => {
        const saved = await reservations.insert(
          aReservationWith(ota, result),
          tx,
        );
        await service.recordAudit(tx, saved.id, result, 'Booking.com');
        throw new Error('falló la revisión de Booking');
      }),
    ).rejects.toThrow('falló la revisión de Booking');

    expect(await rows()).toEqual([]);
    expect(await dataSource.query('SELECT id FROM reservation')).toEqual([]);
  });
});
