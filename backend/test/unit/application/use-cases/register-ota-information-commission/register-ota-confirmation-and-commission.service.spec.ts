import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OtaRepository } from '../../../../../src/application/ports/out/ota.repository.js';
import type { ReservationRepository } from '../../../../../src/application/ports/out/reservation.repository.js';
import type { CommissionInput } from '../../../../../src/application/use-cases/register-ota-information-commission/ports/in/register-ota-confirmation-and-commission.port.js';
import { RegisterOtaConfirmationAndCommissionService } from '../../../../../src/application/use-cases/register-ota-information-commission/register-ota-confirmation-and-commission.service.js';
import type { Ota } from '../../../../../src/domain/ota/ota.js';
import { Money } from '../../../../../src/domain/shared/money.js';
import { anOta } from '../../../../support/builders.js';

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
  return new RegisterOtaConfirmationAndCommissionService(otas, reservations);
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
