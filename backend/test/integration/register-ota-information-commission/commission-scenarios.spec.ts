import { Writable } from 'node:stream';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Logger, PARAMS_PROVIDER_TOKEN } from 'nestjs-pino';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  OTA_REPOSITORY,
  type OtaRepository,
} from '../../../src/application/ports/out/ota.repository.js';
import {
  DuplicateConfirmationCodeError,
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
  type CommissionInput,
  type CommissionResult,
  REGISTER_OTA_CONFIRMATION_AND_COMMISSION,
  type RegisterOtaConfirmationAndCommission,
} from '../../../src/application/use-cases/register-ota-information-commission/ports/in/register-ota-confirmation-and-commission.port.js';
import { configureApp } from '../../../src/configure-app.js';
import type { Ota } from '../../../src/domain/ota/ota.js';
import type { Reservation } from '../../../src/domain/reservation/reservation.js';
import { Money } from '../../../src/domain/shared/money.js';
import { pinoHttpOptions } from '../../../src/infrastructure/shared/logging.options.js';
import { anOta, anOtaReservation, otaTerms } from '../../support/builders.js';
import { integrationEnv, truncateAllTables } from '../support/database.js';

/**
 * T009 de `register-ota-information-commission`: los escenarios 1 a 4 de la historia 1 y los casos borde
 * "código duplicado" y "simultaneidad", con los datos de "Pruebas por escenario" del plan. Todo es real: la
 * aplicación completa, PostgreSQL y sus logs como en producción.
 *
 * Quien registra la reserva de Booking es `generate-ota-reservation` (su T006 todavía no existe), así que
 * la prueba hace sus pasos tal como los dibuja D1: `calculate`; después, en una transacción, guarda el
 * porcentaje si la agencia no lo tenía (`ManageOta.setCommissionPercentage`), inserta la reserva con su
 * comisión y llama a `recordAudit` con `Booking.com`.
 */

const usd = (amount: string) => Money.of(amount, 'USD');

/** Una reserva de Booking como la recibe `generate-ota-reservation`. */
type BookingRevision = {
  grossAmount: string;
  reportedCommission: string | null;
  code: string;
};

/** La reserva guardada, con su comisión tal como la dejó la base (sin pasar por `number`). */
type ReservationRow = {
  external_confirmation_code: string;
  gross_amount: string;
  currency: string;
  commission_percentage: string;
  commission_amount: string;
  commission_status: string;
};

/** Una fila de `commission_audit`. */
type AuditRow = {
  reservation_id: string;
  action: string;
  previous_status: string | null;
  gross_amount: string;
  commission_percentage: string;
  commission_amount: string;
  channel: string;
  performed_by: string;
};

/** Una línea del log de pino (JSON). */
type LogLine = { level: number; context?: string; msg: string };
/** El nivel `warn` de pino. */
const WARN = 40;

describe('Comisión de una reserva OTA: escenarios 1 a 4 de la historia 1, duplicado y simultaneidad (T009)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let commission: RegisterOtaConfirmationAndCommission;
  let manageOta: ManageOta;
  let otas: OtaRepository;
  let reservations: ReservationRepository;
  let transactions: TransactionRunner;
  /** Lo que escribe pino, tal como sale. */
  let written: string[] = [];

  const warnings = (): LogLine[] =>
    written
      .flatMap((chunk) => chunk.split('\n'))
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as LogLine)
      .filter((line) => line.level === WARN);

  const inputOf = (ota: Ota, revision: BookingRevision): CommissionInput => ({
    otaId: ota.id,
    grossAmount: usd(revision.grossAmount),
    reportedCommission:
      revision.reportedCommission === null
        ? null
        : usd(revision.reportedCommission),
    externalConfirmationCode: revision.code,
  });

  /** Los pasos de `generate-ota-reservation` en su transacción, después de `calculate` (D1). */
  const persist = (
    ota: Ota,
    revision: BookingRevision,
    result: CommissionResult,
  ): Promise<Reservation> =>
    transactions.run(async (tx) => {
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
            externalConfirmationCode: revision.code,
            grossAmount: usd(revision.grossAmount),
            commissionPercentage: result.commissionPercentage,
            commissionAmount: result.commissionAmount,
            commissionStatus: result.commissionStatus,
          }),
        }),
        tx,
      );
      await commission.recordAudit(tx, saved.id, result, 'Booking.com');
      return saved;
    });

  /** D1 completo: calcula y, si no hay error, guarda la reserva con su comisión y su auditoría. */
  const register = async (
    ota: Ota,
    revision: BookingRevision,
  ): Promise<Reservation> =>
    persist(ota, revision, await commission.calculate(inputOf(ota, revision)));

  const reservationRows = (): Promise<ReservationRow[]> =>
    dataSource.query(
      `SELECT external_confirmation_code, gross_amount::text, currency, commission_percentage::text,
              commission_amount::text, commission_status
       FROM reservation ORDER BY created_at, external_confirmation_code`,
    );
  const auditRows = (): Promise<AuditRow[]> =>
    dataSource.query(
      `SELECT reservation_id::text, action, previous_status, gross_amount::text,
              commission_percentage::text, commission_amount::text, channel, performed_by
       FROM commission_audit ORDER BY occurred_at`,
    );
  const percentageOf = async (ota: Ota): Promise<string | null> => {
    const [row]: { commission_percentage: string | null }[] =
      await dataSource.query(
        'SELECT commission_percentage::text FROM ota WHERE id = $1',
        [ota.id],
      );
    return row.commission_percentage;
  };

  /** El `errorCode` con el que `calculate` rechaza la reserva. */
  const rejectionOf = async (promise: Promise<unknown>): Promise<string> => {
    try {
      await promise;
    } catch (error) {
      return (error as { errorCode: string }).errorCode;
    }
    throw new Error('La reserva no se rechazó');
  };

  const anAgency = (
    commissionPercentage: string | null,
    name = 'Booking.com',
  ) => otas.insert(anOta({ name, commissionPercentage }));

  beforeAll(async () => {
    // AppConfigModule lee el entorno al importarse: AppModule se importa después de asignarlo.
    Object.assign(process.env, { NODE_ENV: 'test', ...integrationEnv() });
    const { AppModule } = await import('../../../src/app.module.js');
    // Los logs como en producción (todo pasa por nestjs-pino), dirigidos a la prueba.
    const destination = new Writable({
      write(chunk: Buffer, _encoding, done) {
        written.push(chunk.toString());
        done();
      },
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PARAMS_PROVIDER_TOKEN)
      .useValue({ pinoHttp: [pinoHttpOptions('info'), destination] })
      .compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    app.useLogger(app.get(Logger));
    configureApp(app);
    await app.init();
    dataSource = app.get(DataSource);
    commission = app.get(REGISTER_OTA_CONFIRMATION_AND_COMMISSION);
    manageOta = app.get(MANAGE_OTA);
    otas = app.get(OTA_REPOSITORY);
    reservations = app.get(RESERVATION_REPOSITORY);
    transactions = app.get(TRANSACTION_RUNNER);
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    written = [];
  });

  afterAll(async () => {
    await truncateAllTables(dataSource);
    await app?.close();
  });

  it('escenario 1: con la agencia al 15 % y un valor bruto de 400, la reserva guarda 60.00 en CALCULATED y su fila de auditoría', async () => {
    const booking = await anAgency('15.00');

    const reservation = await register(booking, {
      grossAmount: '400.00',
      reportedCommission: '60.00',
      code: '4417829013',
    });

    expect(await reservationRows()).toEqual([
      {
        external_confirmation_code: '4417829013',
        gross_amount: '400.00',
        currency: 'USD',
        commission_percentage: '15.00',
        commission_amount: '60.00',
        commission_status: 'CALCULATED',
      },
    ]);
    expect(await auditRows()).toEqual([
      {
        reservation_id: reservation.id,
        action: 'CALCULATED',
        previous_status: null,
        gross_amount: '400.00',
        commission_percentage: '15.00',
        commission_amount: '60.00',
        channel: 'OTA_API',
        performed_by: 'Booking.com',
      },
    ]);
    expect(warnings()).toEqual([]);
  });

  it('escenario 2: la primera reserva (400 con comisión informada de 60) deja a la agencia en 15.00 y la reserva en 60.00; una segunda de 200 da 30.00', async () => {
    const booking = await anAgency(null);

    await register(booking, {
      grossAmount: '400.00',
      reportedCommission: '60.00',
      code: '4417829013',
    });

    expect(await percentageOf(booking)).toBe('15.00');
    await register(booking, {
      grossAmount: '200.00',
      reportedCommission: '30.00',
      code: '4417829014',
    });

    expect(await percentageOf(booking)).toBe('15.00');
    expect(
      (await reservationRows()).map(
        ({ gross_amount, commission_percentage, commission_amount }) => [
          gross_amount,
          commission_percentage,
          commission_amount,
        ],
      ),
    ).toEqual([
      ['400.00', '15.00', '60.00'],
      ['200.00', '15.00', '30.00'],
    ]);
    expect(await auditRows()).toMatchObject([
      { commission_percentage: '15.00', commission_amount: '60.00' },
      { commission_percentage: '15.00', commission_amount: '30.00' },
    ]);
  });

  describe('escenario 3: la primera reserva sin comisión o con una inválida no deja nada guardado', () => {
    it.each([
      [
        'sin ota_commission',
        { grossAmount: '400.00', reportedCommission: null },
        'COMMISSION_NOT_REPORTED',
      ],
      [
        'con un valor bruto de 0',
        { grossAmount: '0.00', reportedCommission: '0.00' },
        'COMMISSION_NOT_REPORTED',
      ],
      [
        'con una comisión mayor que el valor bruto (500 de 400)',
        { grossAmount: '400.00', reportedCommission: '500.00' },
        'INVALID_COMMISSION_PERCENTAGE',
      ],
    ])('%s: 400 %s', async (_case, amounts, errorCode) => {
      const booking = await anAgency(null);

      expect(
        await rejectionOf(
          register(booking, { ...amounts, code: '4417829013' }),
        ),
      ).toBe(errorCode);

      expect(await reservationRows()).toEqual([]);
      expect(await auditRows()).toEqual([]);
      expect(await percentageOf(booking)).toBeNull();
    });

    it('los mensajes son los de la tabla de errores de B1', async () => {
      const booking = await anAgency(null);

      await expect(
        register(booking, {
          grossAmount: '400.00',
          reportedCommission: null,
          code: '4417829013',
        }),
      ).rejects.toMatchObject({
        message:
          'Booking no informó la comisión de la primera reserva de la agencia.',
      });
      await expect(
        register(booking, {
          grossAmount: '400.00',
          reportedCommission: '500.00',
          code: '4417829013',
        }),
      ).rejects.toMatchObject({
        message: 'El porcentaje de comisión no es válido.',
      });
    });
  });

  it('escenario 4: con la agencia al 15.00 y una comisión informada de 62 sobre 400, la reserva guarda 60.00 y queda una advertencia en el log', async () => {
    const booking = await anAgency('15.00');

    await register(booking, {
      grossAmount: '400.00',
      reportedCommission: '62.00',
      code: '4417829013',
    });

    expect(await reservationRows()).toMatchObject([
      { commission_percentage: '15.00', commission_amount: '60.00' },
    ]);
    expect(await percentageOf(booking)).toBe('15.00');
    const [warning, ...others] = warnings();
    expect(others).toEqual([]);
    expect(warning).toMatchObject({
      context: 'RegisterOtaConfirmationAndCommissionService',
    });
    // 62 de 400 es el 15.50 %; el fijo, 15.00 %. Sin el código de la reserva ni datos del huésped.
    expect(warning.msg).toContain(booking.id);
    expect(warning.msg).toContain('da 15.50 %');
    expect(warning.msg).toMatch(/fijo de 15(\.00)? %/);
    expect(warning.msg).not.toContain('4417829013');
  });

  describe('caso borde: código de confirmación duplicado', () => {
    it('el mismo código en la misma agencia: 400 DUPLICATE_CONFIRMATION_CODE y sin comisión duplicada', async () => {
      const booking = await anAgency('15.00');
      const revision = {
        grossAmount: '400.00',
        reportedCommission: '60.00',
        code: '4417829013',
      };
      await register(booking, revision);

      await expect(register(booking, revision)).rejects.toMatchObject({
        errorCode: 'DUPLICATE_CONFIRMATION_CODE',
        message:
          'El código de confirmación ya está registrado para esta agencia.',
      });

      expect(await reservationRows()).toHaveLength(1);
      expect(await auditRows()).toHaveLength(1);
    });

    it('el mismo código en otra agencia se acepta', async () => {
      const booking = await anAgency('15.00');
      const expedia = await anAgency('18.00', 'Expedia');
      const revision = {
        grossAmount: '400.00',
        reportedCommission: '60.00',
        code: '4417829013',
      };

      await register(booking, revision);
      await register(expedia, revision);

      expect(
        (await reservationRows()).map(
          ({ external_confirmation_code, commission_amount }) => [
            external_confirmation_code,
            commission_amount,
          ],
        ),
      ).toEqual([
        ['4417829013', '60.00'],
        ['4417829013', '72.00'],
      ]);
      expect(await auditRows()).toHaveLength(2);
    });
  });

  it('caso borde, simultaneidad: dos reservas con el mismo código a la vez; una se crea y la otra falla por la restricción única, sin comisión duplicada', async () => {
    const booking = await anAgency('15.00');
    const revision = {
      grossAmount: '400.00',
      reportedCommission: '60.00',
      code: '4417829013',
    };
    // Las dos pasan la revisión de `calculate` antes de que la otra guarde: solo las separa la base.
    const [first, second] = await Promise.all([
      commission.calculate(inputOf(booking, revision)),
      commission.calculate(inputOf(booking, revision)),
    ]);

    const outcomes = await Promise.allSettled([
      persist(booking, revision, first),
      persist(booking, revision, second),
    ]);

    expect(outcomes.map(({ status }) => status).sort()).toEqual([
      'fulfilled',
      'rejected',
    ]);
    const failed = outcomes.find(
      (outcome): outcome is PromiseRejectedResult =>
        outcome.status === 'rejected',
    );
    expect(failed?.reason).toBeInstanceOf(DuplicateConfirmationCodeError);
    expect(await reservationRows()).toHaveLength(1);
    expect(await auditRows()).toHaveLength(1);
  });
});
