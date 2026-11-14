import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  OTA_REPOSITORY,
  type OtaRepository,
} from '../../../src/application/ports/out/ota.repository.js';
import {
  RESERVATION_REPOSITORY,
  type ReservationRepository,
} from '../../../src/application/ports/out/reservation.repository.js';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../src/application/ports/out/transaction.js';
import {
  MANAGE_OTA,
  type ManageOta,
} from '../../../src/application/use-cases/register-ota-information-commission/ports/in/manage-ota.port.js';
import {
  REGISTER_OTA_CONFIRMATION_AND_COMMISSION,
  type RegisterOtaConfirmationAndCommission,
} from '../../../src/application/use-cases/register-ota-information-commission/ports/in/register-ota-confirmation-and-commission.port.js';
import type { Ota } from '../../../src/domain/ota/ota.js';
import { Money } from '../../../src/domain/shared/money.js';
import { anOta, anOtaReservation, otaTerms } from '../../support/builders.js';
import { integrationEnv, truncateAllTables } from '../support/database.js';

/**
 * T020 de `register-ota-information-commission`, NFR-001: "El cálculo y registro de la comisión al validar
 * una reserva OTA debe completarse en un tiempo inferior a 1 segundo".
 *
 * Se mide el registro completo de D1, como lo hará `generate-ota-reservation`: `calculate` (con la revisión
 * del código duplicado en la base) y, en una transacción, guardar el porcentaje si es la primera reserva de
 * la agencia, insertar la reserva con su comisión y `recordAudit`. Todo es real: la aplicación completa y
 * PostgreSQL, con 50 000 reservas de Booking ya guardadas, cargadas con SQL por lotes porque son datos de la
 * prueba. Después de cargarlas se corre `ANALYZE`, como haría el autovacuum de una base en uso.
 */

const LIMIT_MS = 1000;
const STORED_RESERVATIONS = 50_000;

const usd = (amount: string) => Money.of(amount, 'USD');

describe('Comisión de una reserva OTA: cálculo y registro en menos de 1 s (T020, NFR-001)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let commission: RegisterOtaConfirmationAndCommission;
  let manageOta: ManageOta;
  let otas: OtaRepository;
  let reservations: ReservationRepository;
  let transactions: TransactionRunner;
  let booking: Ota;

  /** Cuánto tarda `work`, en milisegundos. */
  async function timed<T>(
    work: () => Promise<T>,
  ): Promise<{ result: T; elapsed: number }> {
    const start = performance.now();
    const result = await work();
    return { result, elapsed: performance.now() - start };
  }

  /** D1: calcula y, en una transacción, guarda el porcentaje si hace falta, la reserva y su auditoría. */
  async function register(
    ota: Ota,
    code: string,
    grossAmount: string,
    reportedCommission: string,
  ): Promise<string> {
    const result = await commission.calculate({
      otaId: ota.id,
      grossAmount: usd(grossAmount),
      reportedCommission: usd(reportedCommission),
      externalConfirmationCode: code,
    });
    return transactions.run(async (tx) => {
      if (result.learnedPercentage) {
        await manageOta.setCommissionPercentage(
          tx,
          ota.id,
          result.commissionPercentage,
        );
      }
      const saved = await reservations.insert(
        anOtaReservation(ota.id, {
          ota: otaTerms(ota.id, {
            externalConfirmationCode: code,
            grossAmount: usd(grossAmount),
            commissionPercentage: result.commissionPercentage,
            commissionAmount: result.commissionAmount,
            commissionStatus: result.commissionStatus,
          }),
        }),
        tx,
      );
      await commission.recordAudit(tx, saved.id, result, 'Booking.com');
      return saved.id;
    });
  }

  /** La comisión que quedó guardada en la reserva y en su auditoría. */
  async function storedCommissionOf(reservationId: string) {
    const [row]: {
      commission_percentage: string;
      commission_amount: string;
      audits: number;
    }[] = await dataSource.query(
      `SELECT r.commission_percentage::text, r.commission_amount::text,
              (SELECT count(*)::int FROM commission_audit a WHERE a.reservation_id = r.id) AS audits
       FROM reservation r WHERE r.id = $1`,
      [reservationId],
    );
    return row;
  }

  beforeAll(async () => {
    // AppConfigModule lee el entorno al importarse: AppModule se importa después de asignarlo.
    Object.assign(process.env, { NODE_ENV: 'test', ...integrationEnv() });
    const { AppModule } = await import('../../../src/app.module.js');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    dataSource = app.get(DataSource);
    commission = app.get(REGISTER_OTA_CONFIRMATION_AND_COMMISSION);
    manageOta = app.get(MANAGE_OTA);
    otas = app.get(OTA_REPOSITORY);
    reservations = app.get(RESERVATION_REPOSITORY);
    transactions = app.get(TRANSACTION_RUNNER);

    await truncateAllTables(dataSource);
    booking = await otas.insert(anOta({ commissionPercentage: '15.00' }));
    // 50 000 reservas de Booking con su comisión, cada una con su código de confirmación.
    await dataSource.query(
      `INSERT INTO reservation
         (id, reservation_ref, source, ota_id, external_confirmation_code, start_date, end_date,
          guest_count, status, gross_amount, currency, commission_percentage, commission_amount,
          commission_status)
       SELECT gen_random_uuid(), 'RSV-' || upper(lpad(to_hex(g), 8, '0')), 'OTA', $1::uuid,
              'LOAD-' || g, DATE '2026-01-01' + (g % 700), DATE '2026-01-03' + (g % 700), 2,
              'ACTIVE', 400, 'USD', 15, 60, 'CALCULATED'
       FROM generate_series(1, $2::int) AS g`,
      [booking.id, STORED_RESERVATIONS],
    );
    await dataSource.query('ANALYZE reservation');
    // Un registro antes de medir: la primera conexión a la base no es la condición normal.
    await register(booking, 'WARM-UP', '400.00', '60.00');
  }, 120_000);

  afterAll(async () => {
    // Las demás pruebas no tienen por qué cargar con 50 000 reservas.
    if (dataSource !== undefined) {
      await truncateAllTables(dataSource);
    }
    await app?.close();
  });

  it('la base tiene las 50 000 reservas de la agencia', async () => {
    const [{ total }]: { total: number }[] = await dataSource.query(
      'SELECT count(*)::int AS total FROM reservation WHERE ota_id = $1',
      [booking.id],
    );

    expect(total).toBe(STORED_RESERVATIONS + 1);
  });

  it(`con la agencia al 15 %: calcula y registra la comisión de una reserva de 400 en menos de ${LIMIT_MS / 1000} s`, async () => {
    const { result: reservationId, elapsed } = await timed(() =>
      register(booking, '4417829013', '400.00', '60.00'),
    );

    expect(elapsed).toBeLessThan(LIMIT_MS);
    // Fue el registro completo: la comisión en la reserva y su fila de auditoría.
    expect(await storedCommissionOf(reservationId)).toEqual({
      commission_percentage: '15.00',
      commission_amount: '60.00',
      audits: 1,
    });
  });

  it(`la primera reserva de una agencia sin porcentaje, que además lo guarda, en menos de ${LIMIT_MS / 1000} s`, async () => {
    const expedia = await otas.insert(
      anOta({ name: 'Expedia', commissionPercentage: null }),
    );

    const { result: reservationId, elapsed } = await timed(() =>
      register(expedia, '4417829013', '400.00', '60.00'),
    );

    expect(elapsed).toBeLessThan(LIMIT_MS);
    expect(await storedCommissionOf(reservationId)).toEqual({
      commission_percentage: '15.00',
      commission_amount: '60.00',
      audits: 1,
    });
    const [{ commission_percentage }]: { commission_percentage: string }[] =
      await dataSource.query(
        'SELECT commission_percentage::text FROM ota WHERE id = $1',
        [expedia.id],
      );
    expect(commission_percentage).toBe('15.00');
  });

  it(`un código ya registrado entre las 50 000 se rechaza en menos de ${LIMIT_MS / 1000} s, sin guardar nada`, async () => {
    const { result: outcome, elapsed } = await timed(() =>
      register(booking, 'LOAD-49999', '400.00', '60.00').then(
        () => 'registrada',
        (error: { errorCode?: string }) => error.errorCode,
      ),
    );

    expect(elapsed).toBeLessThan(LIMIT_MS);
    expect(outcome).toBe('DUPLICATE_CONFIRMATION_CODE');
    const [{ total }]: { total: number }[] = await dataSource.query(
      `SELECT count(*)::int AS total FROM reservation WHERE external_confirmation_code = 'LOAD-49999'`,
    );
    expect(total).toBe(1);
  });
});
