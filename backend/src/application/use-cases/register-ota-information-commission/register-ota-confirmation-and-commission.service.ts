import { Inject, Injectable, Logger } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import {
  calculateCommission,
  commissionPercentageOf,
} from '../../../domain/ota/commission.js';
import { isPercentage } from '../../../domain/ota/ota.js';
import { BusinessError } from '../../../domain/shared/business-error.js';
import type { Money } from '../../../domain/shared/money.js';
import {
  OTA_REPOSITORY,
  type OtaRepository,
} from '../../ports/out/ota.repository.js';
import {
  RESERVATION_REPOSITORY,
  type ReservationRepository,
} from '../../ports/out/reservation.repository.js';
import {
  COMMISSION_NOT_REPORTED,
  DUPLICATE_CONFIRMATION_CODE,
  INVALID_COMMISSION_PERCENTAGE,
  OTA_NOT_FOUND,
} from './error-codes.js';
import type {
  CommissionInput,
  CommissionResult,
  RegisterOtaConfirmationAndCommission,
} from './ports/in/register-ota-confirmation-and-commission.port.js';

/** Diferencia, en puntos, a partir de la cual la comisión informada no coincide con el fijo (FR-004a). */
const MISMATCH_TOLERANCE = new Decimal('0.01');

/**
 * Calcula la comisión de una reserva OTA nueva con el porcentaje fijo de la agencia (plan, B1 y reglas 1
 * y 1a). Si la agencia todavía no lo tiene, lo calcula con esta reserva y lo devuelve con
 * `learnedPercentage`, para que quien llama lo guarde en su transacción.
 */
@Injectable()
export class RegisterOtaConfirmationAndCommissionService implements RegisterOtaConfirmationAndCommission {
  private readonly logger = new Logger(
    RegisterOtaConfirmationAndCommissionService.name,
  );

  constructor(
    @Inject(OTA_REPOSITORY)
    private readonly otas: OtaRepository,
    @Inject(RESERVATION_REPOSITORY)
    private readonly reservations: ReservationRepository,
  ) {}

  async calculate(input: CommissionInput): Promise<CommissionResult> {
    const ota = await this.otas.findById(input.otaId);
    if (ota === null) {
      throw new BusinessError(OTA_NOT_FOUND.code, OTA_NOT_FOUND.message);
    }

    let commissionPercentage = ota.commissionPercentage;
    const learnedPercentage = commissionPercentage === null;
    if (commissionPercentage === null) {
      if (input.reportedCommission === null || !isPositive(input.grossAmount)) {
        throw new BusinessError(
          COMMISSION_NOT_REPORTED.code,
          COMMISSION_NOT_REPORTED.message,
        );
      }
      commissionPercentage = commissionPercentageOf(
        input.reportedCommission,
        input.grossAmount,
      );
    }
    if (!isPercentage(commissionPercentage)) {
      throw new BusinessError(
        INVALID_COMMISSION_PERCENTAGE.code,
        INVALID_COMMISSION_PERCENTAGE.message,
      );
    }
    if (
      await this.reservations.existsOtaConfirmationCode(
        input.otaId,
        input.externalConfirmationCode,
      )
    ) {
      throw new BusinessError(
        DUPLICATE_CONFIRMATION_CODE.code,
        DUPLICATE_CONFIRMATION_CODE.message,
      );
    }
    if (!learnedPercentage) {
      this.warnIfMismatch(input, commissionPercentage);
    }

    return {
      otaId: input.otaId,
      commissionPercentage,
      learnedPercentage,
      commissionAmount: calculateCommission(
        input.grossAmount,
        commissionPercentage,
      ),
      commissionStatus: 'CALCULATED',
    };
  }

  /** FR-004a: la comisión informada da otro porcentaje; se usa igual el fijo. */
  private warnIfMismatch(input: CommissionInput, fixed: string): void {
    if (input.reportedCommission === null || !isPositive(input.grossAmount)) {
      return;
    }
    const reported = commissionPercentageOf(
      input.reportedCommission,
      input.grossAmount,
    );
    if (new Decimal(reported).minus(fixed).abs().gt(MISMATCH_TOLERANCE)) {
      // Sin datos personales: solo la agencia y los porcentajes.
      this.logger.warn(
        `La comisión que informa la agencia ${input.otaId} da ${reported} %, distinto de su porcentaje fijo de ${fixed} %: se aplica el fijo`,
      );
    }
  }
}

function isPositive(amount: Money): boolean {
  return new Decimal(amount.amount).gt(0);
}
