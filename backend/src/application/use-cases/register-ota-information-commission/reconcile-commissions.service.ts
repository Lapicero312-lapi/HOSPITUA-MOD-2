import { Inject, Injectable, Logger } from '@nestjs/common';
import { canChangeCommissionStatus } from '../../../domain/ota/commission.js';
import type { Reservation } from '../../../domain/reservation/reservation.js';
import { Money } from '../../../domain/shared/money.js';
import {
  COMMISSION_AUDIT_REPOSITORY,
  type CommissionAuditRepository,
} from '../../ports/out/commission-audit.repository.js';
import {
  RESERVATION_REPOSITORY,
  type ReservationRepository,
} from '../../ports/out/reservation.repository.js';
import {
  TRANSACTION_RUNNER,
  type Transaction,
  type TransactionRunner,
} from '../../ports/out/transaction.js';
import type {
  ReconcileCommissions,
  ReconciliationAction,
  ReconciliationItem,
  ReconciliationItemResult,
  ReconciliationOutcome,
  ReconciliationRejection,
} from './ports/in/reconcile-commissions.port.js';

/** Quién concilia: el canal y `performedBy` de la auditoría (regla 6 del plan). */
const MODULE3 = 'MODULE3';

/**
 * `ReconcileCommissions` (plan de `register-ota-information-commission`, C.2; FR-006 y FR-007; T012). Cada
 * ítem va en su propia transacción, con la reserva bloqueada (`SELECT … FOR UPDATE`, regla 7), para que dos
 * conciliaciones o un cambio de Booking sobre la misma reserva se procesen en secuencia.
 */
@Injectable()
export class ReconcileCommissionsService implements ReconcileCommissions {
  private readonly logger = new Logger(ReconcileCommissionsService.name);

  constructor(
    @Inject(RESERVATION_REPOSITORY)
    private readonly reservations: ReservationRepository,
    @Inject(COMMISSION_AUDIT_REPOSITORY)
    private readonly audits: CommissionAuditRepository,
    @Inject(TRANSACTION_RUNNER)
    private readonly transactions: TransactionRunner,
  ) {}

  async execute(
    action: ReconciliationAction,
    items: readonly ReconciliationItem[],
  ): Promise<ReconciliationOutcome> {
    const results: ReconciliationItemResult[] = [];
    for (const item of items) {
      results.push(await this.reconcileItem(action, item));
    }
    return {
      action,
      results,
      summary: {
        applied: count(results, 'APPLIED'),
        alreadyApplied: count(results, 'ALREADY_APPLIED'),
        rejected: count(results, 'REJECTED'),
      },
    };
  }

  /** Un ítem en su transacción: un error inesperado revierte solo este ítem y no detiene los demás. */
  private async reconcileItem(
    action: ReconciliationAction,
    item: ReconciliationItem,
  ): Promise<ReconciliationItemResult> {
    try {
      return await this.transactions.run((tx) => this.decide(tx, action, item));
    } catch (error) {
      // Sin datos personales: la referencia de la reserva no lo es.
      this.logger.error(
        `No se pudo conciliar la comisión de la reserva ${item.reservationRef}`,
        error instanceof Error ? error.stack : String(error),
      );
      return rejected(item.reservationRef, null, 'REQUEST_NOT_PROCESSED');
    }
  }

  /** Los casos de C.2, en su orden: el primero que se cumple da el resultado. */
  private async decide(
    tx: Transaction,
    action: ReconciliationAction,
    item: ReconciliationItem,
  ): Promise<ReconciliationItemResult> {
    const { reservationRef } = item;
    const reservation = await this.reservations.lockByRef(reservationRef, tx);
    if (reservation === null) {
      return rejected(reservationRef, null, 'RESERVATION_NOT_FOUND');
    }
    const { ota } = reservation;
    if (reservation.source !== 'OTA' || ota === null) {
      return rejected(reservationRef, null, 'NOT_OTA_RESERVATION');
    }
    const current = ota.commissionStatus;
    const stateReason = reasonForStatus(reservation);
    if (stateReason !== null) {
      return rejected(reservationRef, current, stateReason);
    }
    if (!amountsMatch(reservation, item)) {
      return rejected(reservationRef, current, 'AMOUNT_MISMATCH');
    }
    if (current === action) {
      return {
        reservationRef,
        result: 'ALREADY_APPLIED',
        commissionStatus: current,
        reason: null,
      };
    }
    if (!canChangeCommissionStatus(current, action)) {
      return rejected(reservationRef, current, 'INVALID_TRANSITION');
    }

    const saved = await this.reservations.update(
      reservation.withCommissionStatus(action),
      tx,
    );
    await this.audits.record(
      {
        reservationId: saved.id,
        otaId: ota.otaId,
        action,
        previousStatus: current,
        grossAmount: ota.grossAmount,
        commissionPercentage: ota.commissionPercentage,
        commissionAmount: ota.commissionAmount,
        channel: MODULE3,
        performedBy: MODULE3,
      },
      tx,
    );
    return {
      reservationRef,
      result: 'APPLIED',
      commissionStatus: action,
      reason: null,
    };
  }
}

/**
 * Casos 3 a 5: solo se concilian las reservas que finalizaron su estadía. Una cancelada o en no-show no
 * cambia su comisión (FR-007).
 */
function reasonForStatus(
  reservation: Reservation,
): ReconciliationRejection | null {
  switch (reservation.status) {
    case 'COMPLETED':
      return null;
    case 'CANCELLED':
      return 'RESERVATION_CANCELLED';
    case 'NO_SHOW':
      return 'RESERVATION_NO_SHOW';
    default:
      return 'RESERVATION_NOT_COMPLETED';
  }
}

/**
 * Caso 6: el `grossAmount` y el `commissionAmount` que envía el Módulo 3 valen lo mismo que los guardados
 * (`400` es igual a `400.00`). El Módulo 3 no envía la moneda: es la de la reserva.
 */
function amountsMatch(
  reservation: Reservation,
  item: ReconciliationItem,
): boolean {
  const { ota } = reservation;
  if (ota === null) {
    return false;
  }
  const { currency } = ota.grossAmount;
  return (
    ota.grossAmount.equals(Money.of(item.grossAmount, currency)) &&
    ota.commissionAmount.equals(Money.of(item.commissionAmount, currency))
  );
}

function rejected(
  reservationRef: string,
  commissionStatus: ReconciliationItemResult['commissionStatus'],
  reason: ReconciliationRejection,
): ReconciliationItemResult {
  return { reservationRef, result: 'REJECTED', commissionStatus, reason };
}

function count(
  results: readonly ReconciliationItemResult[],
  result: ReconciliationItemResult['result'],
): number {
  return results.filter((item) => item.result === result).length;
}
