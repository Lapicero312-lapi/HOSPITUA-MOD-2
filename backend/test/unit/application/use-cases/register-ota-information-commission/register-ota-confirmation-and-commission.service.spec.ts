import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CommissionAuditEntry,
  CommissionAuditRepository,
} from '../../../../../src/application/ports/out/commission-audit.repository.js';
import type { OtaRepository } from '../../../../../src/application/ports/out/ota.repository.js';
import type { ReservationRepository } from '../../../../../src/application/ports/out/reservation.repository.js';
import type { Transaction } from '../../../../../src/application/ports/out/transaction.js';
import type {
  CommissionInput,
  CommissionResult,
} from '../../../../../src/application/use-cases/register-ota-information-commission/ports/in/register-ota-confirmation-and-commission.port.js';
import { RegisterOtaConfirmationAndCommissionService } from '../../../../../src/application/use-cases/register-ota-information-commission/register-ota-confirmation-and-commission.service.js';
import type { Ota } from '../../../../../src/domain/ota/ota.js';
import type { Reservation } from '../../../../../src/domain/reservation/reservation.js';
import { Money } from '../../../../../src/domain/shared/money.js';
import {
  aDirectReservation,
  anOta,
  anOtaReservation,
  otaTerms,
} from '../../../../support/builders.js';

const usd = (amount: string) => Money.of(amount, 'USD');

/** Una agencia guardada y, si se pide, un código de confirmación ya registrado para ella. */
function serviceWith(ota: Ota | null, existingCode: string | null = null) {
  const otas = {
    findById: vi.fn((id: string) =>
      Promise.resolve(ota !== null && ota.id === id ? ota : null),
    ),
  } as unknown as OtaRepository;
  const reservations = {
    existsOtaConfirmationCode: vi.fn((_otaId: string, code: string) =>
      Promise.resolve(code === existingCode),
    ),
  } as unknown as ReservationRepository;
  // calculate no audita: el registro de auditoría no se usa.
  return new RegisterOtaConfirmationAndCommissionService(
    otas,
    reservations,
    {} as CommissionAuditRepository,
  );
}

const anInput = (
  ota: Ota,
  changes: Partial<CommissionInput> = {},
): CommissionInput => ({
  otaId: ota.id,
  grossAmount: usd('400.00'),
  reportedCommission: usd('60.00'),
  externalConfirmationCode: '4417829013',
  ...changes,
});

describe('RegisterOtaConfirmationAndCommission.calculate', () => {
  let warnings: string[];

  beforeEach(() => {
    warnings = [];
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(
      (message: unknown) => {
        warnings.push(String(message));
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('escenario 1: con el porcentaje fijo de la agencia, 400 al 15 % da 60.00 y CALCULATED', async () => {
    const ota = anOta({ commissionPercentage: '15' });

    const result = await serviceWith(ota).calculate(anInput(ota));

    expect(result).toMatchObject({
      otaId: ota.id,
      commissionPercentage: '15',
      learnedPercentage: false,
      commissionStatus: 'CALCULATED',
    });
    expect(result.commissionAmount.amount).toBe('60');
    expect(result.commissionAmount.currency).toBe('USD');
    expect(warnings).toEqual([]);
  });

  it('escenario 2: la primera reserva calcula el porcentaje, 60 de 400 da 15.00, para guardarlo en la agencia', async () => {
    const ota = anOta({ commissionPercentage: null });

    const result = await serviceWith(ota).calculate(anInput(ota));

    expect(result.commissionPercentage).toBe('15.00');
    expect(result.learnedPercentage).toBe(true);
    expect(result.commissionAmount.amount).toBe('60');
  });

  it('escenario 2: una segunda reserva de 200 con el porcentaje ya guardado da 30.00', async () => {
    const ota = anOta({ commissionPercentage: '15.00' });

    const result = await serviceWith(ota).calculate(
      anInput(ota, {
        grossAmount: usd('200.00'),
        reportedCommission: usd('30.00'),
      }),
    );

    expect(result.commissionAmount.amount).toBe('30');
    expect(result.learnedPercentage).toBe(false);
  });

  // Por habitación, 15.045 se redondearía dos veces a 15.05 y la suma daría 30.10 (plan, regla 1).
  it('se calcula una sola vez sobre el total: dos habitaciones de 100.30 al 15 % dan 30.09', async () => {
    const ota = anOta({ commissionPercentage: '15' });

    const result = await serviceWith(ota).calculate(
      anInput(ota, {
        grossAmount: usd('200.60'),
        reportedCommission: usd('30.09'),
      }),
    );

    expect(result.commissionAmount.amount).toBe('30.09');
  });

  it('el porcentaje calculado se redondea a dos decimales: 10 de 153 da 6.54', async () => {
    const ota = anOta({ commissionPercentage: null });

    const result = await serviceWith(ota).calculate(
      anInput(ota, {
        grossAmount: usd('153.00'),
        reportedCommission: usd('10.00'),
      }),
    );

    expect(result.commissionPercentage).toBe('6.54');
    expect(result.commissionAmount.amount).toBe('10.01');
  });

  it.each([
    ['sin ota_commission', { reportedCommission: null }],
    ['con un valor bruto de 0', { grossAmount: usd('0.00') }],
  ])(
    'escenario 3: la primera reserva %s es COMMISSION_NOT_REPORTED',
    async (_, changes) => {
      const ota = anOta({ commissionPercentage: null });

      await expect(
        serviceWith(ota).calculate(anInput(ota, changes)),
      ).rejects.toMatchObject({
        errorCode: 'COMMISSION_NOT_REPORTED',
        message:
          'Booking no informó la comisión de la primera reserva de la agencia.',
      });
    },
  );

  it('escenario 3: una primera reserva con una comisión mayor que el valor bruto es INVALID_COMMISSION_PERCENTAGE', async () => {
    const ota = anOta({ commissionPercentage: null });

    await expect(
      serviceWith(ota).calculate(
        anInput(ota, { reportedCommission: usd('401.00') }),
      ),
    ).rejects.toMatchObject({
      errorCode: 'INVALID_COMMISSION_PERCENTAGE',
      message: 'El porcentaje de comisión no es válido.',
    });
  });

  it.each([
    [
      'una comisión mayor que el valor bruto',
      { reportedCommission: usd('401.00') },
      'INVALID_COMMISSION_PERCENTAGE',
    ],
    [
      'sin ota_commission',
      { reportedCommission: null },
      'COMMISSION_NOT_REPORTED',
    ],
  ])(
    'el orden del plan: una primera reserva con %s y además un código repetido da %s, no DUPLICATE_CONFIRMATION_CODE',
    async (_, changes, errorCode) => {
      const ota = anOta({ commissionPercentage: null });

      await expect(
        serviceWith(ota, '4417829013').calculate(anInput(ota, changes)),
      ).rejects.toMatchObject({ errorCode });
    },
  );

  it('el orden del plan: una agencia que no existe da OTA_NOT_FOUND aunque falte la comisión', async () => {
    const ota = anOta({ commissionPercentage: null });

    await expect(
      serviceWith(null, '4417829013').calculate(
        anInput(ota, { reportedCommission: null }),
      ),
    ).rejects.toMatchObject({ errorCode: 'OTA_NOT_FOUND' });
  });

  it('escenario 4: una comisión informada que no coincide (62 de 400 es 15.50) aplica el 15 y deja una advertencia', async () => {
    const ota = anOta({ commissionPercentage: '15' });

    const result = await serviceWith(ota).calculate(
      anInput(ota, { reportedCommission: usd('62.00') }),
    );

    expect(result.commissionAmount.amount).toBe('60');
    expect(warnings).toEqual([
      `La comisión que informa la agencia ${ota.id} da 15.50 %, distinto de su porcentaje fijo de 15 %: se aplica el fijo`,
    ]);
  });

  it('una diferencia de 0.01 puntos o menos no deja advertencia', async () => {
    const ota = anOta({ commissionPercentage: '15' });

    await serviceWith(ota).calculate(
      anInput(ota, { reportedCommission: usd('60.04') }),
    );

    expect(warnings).toEqual([]);
  });

  it('sin comisión informada, con el porcentaje ya guardado, calcula sin advertencia', async () => {
    const ota = anOta({ commissionPercentage: '15' });

    const result = await serviceWith(ota).calculate(
      anInput(ota, { reportedCommission: null }),
    );

    expect(result.commissionAmount.amount).toBe('60');
    expect(warnings).toEqual([]);
  });

  it('una agencia que no existe es OTA_NOT_FOUND', async () => {
    const ota = anOta();

    await expect(
      serviceWith(null).calculate(anInput(ota)),
    ).rejects.toMatchObject({
      errorCode: 'OTA_NOT_FOUND',
      message: 'La agencia no existe.',
    });
  });

  it('un código de confirmación ya registrado para la agencia es DUPLICATE_CONFIRMATION_CODE', async () => {
    const ota = anOta();

    await expect(
      serviceWith(ota, '4417829013').calculate(anInput(ota)),
    ).rejects.toMatchObject({
      errorCode: 'DUPLICATE_CONFIRMATION_CODE',
      message:
        'El código de confirmación ya está registrado para esta agencia.',
    });
  });
});

/** La transacción de quien llama: el servicio solo la pasa a los repositorios. */
const TX = { id: 'tx' } as unknown as Transaction;

/**
 * El servicio con la reserva guardada que devuelve el repositorio y, si se pide, filas de auditoría ya
 * registradas para ella. Devuelve también los dobles, para ver qué intentó registrar.
 */
function auditingServiceWith(
  saved: Reservation | null,
  alreadyAudited = false,
) {
  const reservations = {
    findById: vi.fn((id: string, _tx?: Transaction) =>
      Promise.resolve(saved !== null && saved.id === id ? saved : null),
    ),
  };
  const audits = {
    record: vi.fn((_entry: CommissionAuditEntry, _tx: Transaction) =>
      Promise.resolve(),
    ),
    existsFor: vi.fn((_reservationId: string, _tx: Transaction) =>
      Promise.resolve(alreadyAudited),
    ),
  };
  const service = new RegisterOtaConfirmationAndCommissionService(
    {} as OtaRepository,
    reservations as unknown as ReservationRepository,
    audits,
  );
  return { service, reservations, audits };
}

/** El resultado del escenario 1: 400 al 15 % da 60. */
const aResult = (
  otaId: string,
  changes: Partial<CommissionResult> = {},
): CommissionResult => ({
  otaId,
  commissionPercentage: '15',
  learnedPercentage: false,
  commissionAmount: usd('60'),
  commissionStatus: 'CALCULATED',
  ...changes,
});

describe('RegisterOtaConfirmationAndCommission.recordAudit (T007)', () => {
  it('la primera comisión de la reserva deja la fila CALCULATED, sin estado anterior, con OTA_API y quien la hizo', async () => {
    const ota = anOta();
    const reservation = anOtaReservation(ota.id);
    const { service, audits } = auditingServiceWith(reservation);

    await service.recordAudit(
      TX,
      reservation.id,
      aResult(ota.id),
      'Booking.com',
    );

    expect(audits.record).toHaveBeenCalledTimes(1);
    const [entry, tx] = audits.record.mock.calls[0];
    expect(tx).toBe(TX);
    expect(entry).toEqual({
      reservationId: reservation.id,
      otaId: ota.id,
      action: 'CALCULATED',
      previousStatus: null,
      grossAmount: usd('400'),
      commissionPercentage: '15',
      commissionAmount: usd('60'),
      channel: 'OTA_API',
      performedBy: 'Booking.com',
    });
  });

  it('una recalculación deja el estado anterior CALCULATED y el valor bruto nuevo de la reserva guardada', async () => {
    const ota = anOta();
    // Booking cambió el valor a 500: ApplyOtaChange ya guardó la reserva con él.
    const reservation = anOtaReservation(ota.id, {
      ota: otaTerms(ota.id, {
        grossAmount: usd('500'),
        commissionAmount: usd('75'),
      }),
    });
    const { service, audits } = auditingServiceWith(reservation, true);

    await service.recordAudit(
      TX,
      reservation.id,
      aResult(ota.id, { commissionAmount: usd('75') }),
      'Booking.com',
    );

    expect(audits.record.mock.calls[0][0]).toMatchObject({
      action: 'CALCULATED',
      previousStatus: 'CALCULATED',
      grossAmount: usd('500'),
      commissionAmount: usd('75'),
    });
  });

  it('lee la reserva y las filas anteriores en la transacción de quien llama, que aún no confirma la reserva', async () => {
    const ota = anOta();
    const reservation = anOtaReservation(ota.id);
    const { service, reservations, audits } = auditingServiceWith(reservation);

    await service.recordAudit(
      TX,
      reservation.id,
      aResult(ota.id),
      'Booking.com',
    );

    expect(reservations.findById).toHaveBeenCalledWith(reservation.id, TX);
    expect(audits.existsFor).toHaveBeenCalledWith(reservation.id, TX);
  });

  it('el porcentaje, el importe y la agencia salen del resultado del cálculo', async () => {
    const ota = anOta({ commissionPercentage: null });
    const reservation = anOtaReservation(ota.id);
    const { service, audits } = auditingServiceWith(reservation);

    await service.recordAudit(
      TX,
      reservation.id,
      aResult(ota.id, {
        commissionPercentage: '6.54',
        learnedPercentage: true,
        commissionAmount: usd('26.16'),
      }),
      'Booking.com',
    );

    expect(audits.record.mock.calls[0][0]).toMatchObject({
      otaId: ota.id,
      commissionPercentage: '6.54',
      commissionAmount: usd('26.16'),
    });
  });

  it('una reserva que no existe es un error del programa y no deja ninguna fila', async () => {
    const ota = anOta();
    const { service, audits } = auditingServiceWith(null);

    await expect(
      service.recordAudit(
        TX,
        'reserva-inexistente',
        aResult(ota.id),
        'Booking.com',
      ),
    ).rejects.toThrow('no existe o no es de OTA');
    expect(audits.record).not.toHaveBeenCalled();
  });

  it('una reserva directa no tiene comisión: es un error del programa y no deja ninguna fila', async () => {
    const ota = anOta();
    const reservation = aDirectReservation();
    const { service, audits } = auditingServiceWith(reservation);

    await expect(
      service.recordAudit(TX, reservation.id, aResult(ota.id), 'Booking.com'),
    ).rejects.toThrow('no existe o no es de OTA');
    expect(audits.record).not.toHaveBeenCalled();
  });
});
