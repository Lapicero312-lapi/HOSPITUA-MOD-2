import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Cancellation } from '../../../domain/cancellation/cancellation.js';
import {
  canCancelThroughChannel,
  isCancellable,
} from '../../../domain/cancellation/cancellation-rules.js';
import type { Reservation } from '../../../domain/reservation/reservation.js';
import { BusinessError } from '../../../domain/shared/business-error.js';
import type {
  CancellationChannel,
  StatusReason,
} from '../../../domain/shared/enums.js';
import {
  CONCURRENT_UPDATE,
  RESERVATION_NOT_FOUND,
} from '../../../domain/shared/error-codes.js';
import type { AriChange } from '../../ports/out/ari-pending-change.repository.js';
import {
  CANCELLATION_REPOSITORY,
  DuplicateCancellationError,
  type CancellationRepository,
} from '../../ports/out/cancellation.repository.js';
import { CLOCK, type Clock } from '../../ports/out/clock.js';
import {
  type Transaction,
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../ports/out/transaction.js';
import {
  DAILY_LIST_CHANGE_RECORDER,
  type DailyListChangeRecorder,
} from '../check-view-reservation/ports/in/daily-list-change-recorder.port.js';
import {
  RESERVATION_LOOKUP,
  type ReservationLookup,
} from '../check-view-reservation/ports/in/reservation-lookup.port.js';
import {
  ARI_CHANGE_RECORDER,
  type AriChangeRecorder,
} from '../configure-ota/ports/in/ari-change-recorder.port.js';
import {
  RESERVATION_STATUS,
  type ReservationStatusPort,
} from '../update-reservation/ports/in/reservation-status.port.js';
import {
  checkAcknowledged,
  checkCancelRequest,
} from './cancel-request.validator.js';
import {
  OTA_RESERVATION_CANCEL_VIA_API,
  STATUS_NOT_CANCELLABLE,
} from './error-codes.js';
import type {
  CancellationResult,
  CancelReservation,
  CancelReservationCommand,
} from './ports/in/cancel-reservation.port.js';
import { isSameInstant } from './same-instant.js';

/** El `status_reason` de la cancelación según quién la hace (plan, punto 7). */
const STATUS_REASON_BY_CHANNEL: Record<CancellationChannel, StatusReason> = {
  RECEPTION: 'CANCELLED_BY_RECEPTION',
  OTA_API: 'CANCELLED_BY_OTA',
};

/**
 * `CancelReservation` (plan de `cancel-reservation`, regla 3 y punto 10; T005 a T009). Usa los puertos de
 * entrada de `check-view-reservation`, `update-reservation` y `configure-ota` (regla 6). `cancel` va en la
 * transacción de quien llama (Booking) y `execute` abre la suya (la Recepcionista): si algo falla, no queda
 * nada a medias (regla 4).
 *
 * Lo que Booking ya no puede cancelar no es un error (contrato B): la reserva se devuelve sin tocarla, con
 * su estado, y `generate-ota-reservation` la ignora o marca el conflicto.
 */
@Injectable()
export class CancelReservationService implements CancelReservation {
  constructor(
    @Inject(RESERVATION_LOOKUP)
    private readonly lookup: ReservationLookup,
    @Inject(RESERVATION_STATUS)
    private readonly status: ReservationStatusPort,
    @Inject(CANCELLATION_REPOSITORY)
    private readonly cancellations: CancellationRepository,
    @Inject(DAILY_LIST_CHANGE_RECORDER)
    private readonly dailyList: DailyListChangeRecorder,
    @Inject(CLOCK)
    private readonly clock: Clock,
    @Inject(TRANSACTION_RUNNER)
    private readonly transactions: TransactionRunner,
    @Inject(ARI_CHANGE_RECORDER)
    private readonly availability: AriChangeRecorder,
  ) {}

  async cancel(
    tx: Transaction,
    command: CancelReservationCommand,
  ): Promise<Reservation> {
    const before = await this.verify(tx, command);
    // Contrato B: Booking puede repetir la revisión, y el conflicto lo marca `generate-ota-reservation`.
    if (command.channel === 'OTA_API' && !isCancellable(before.status)) {
      return before;
    }
    return (await this.apply(tx, before, command)).reservation;
  }

  async execute(
    command: CancelReservationCommand,
  ): Promise<CancellationResult> {
    const { reservation, cancellation } = await this.transactions.run(
      async (tx) => this.apply(tx, await this.verify(tx, command), command),
    );
    return {
      reservationRef: reservation.reservationRef,
      status: 'CANCELLED',
      cancellation: {
        cancellationId: cancellation.id,
        cancellationDate: cancellation.cancellationDate,
        channel: cancellation.channel,
        reason: cancellation.reason,
        processedBy: cancellation.processedBy,
        status: cancellation.status,
      },
    };
  }

  /** Los pasos 1 a 4 de la regla 3, en orden. Devuelve la reserva, bloqueada hasta el final de `tx`. */
  private async verify(
    tx: Transaction,
    command: CancelReservationCommand,
  ): Promise<Reservation> {
    // Paso 1, antes de consultar la base: la referencia y el motivo (punto 9).
    checkCancelRequest(command.reservationRef, command.reason);

    // Paso 2: la reserva existe, queda bloqueada hasta el final de tx y es del canal que corresponde.
    const before = await this.lookup.findForUpdate(tx, command.reservationRef);
    if (before === null) {
      throw new BusinessError(
        RESERVATION_NOT_FOUND.code,
        RESERVATION_NOT_FOUND.message,
      );
    }
    checkChannel(before, command.channel);

    // Paso 3: la casilla de confirmación, solo para la Recepcionista (FR-002b).
    if (command.channel === 'RECEPTION') {
      checkAcknowledged(command.acknowledged);
    }

    // Paso 4, antes del estado: la segunda de dos cancelaciones simultáneas recibe el mensaje de
    // concurrencia del spec, no el del estado. En A el `updatedAt` es obligatorio: sin él no coincide.
    const checksUpdatedAt =
      command.channel === 'RECEPTION' ||
      command.expectedUpdatedAt !== undefined;
    if (
      checksUpdatedAt &&
      (command.expectedUpdatedAt === undefined ||
        before.updatedAt === null ||
        !isSameInstant(command.expectedUpdatedAt, before.updatedAt))
    ) {
      throw new BusinessError(
        CONCURRENT_UPDATE.code,
        CONCURRENT_UPDATE.message,
      );
    }
    return before;
  }

  /** El paso 5 y, si pasa, el cambio, la `Cancellation` y los avisos, todo en `tx`. */
  private async apply(
    tx: Transaction,
    before: Reservation,
    command: CancelReservationCommand,
  ): Promise<{ reservation: Reservation; cancellation: Cancellation }> {
    // Paso 5: solo ACTIVE o PENDING (regla 2).
    if (!isCancellable(before.status)) {
      throw new BusinessError(
        STATUS_NOT_CANCELLABLE.code,
        STATUS_NOT_CANCELLABLE.message,
      );
    }

    // T006: el cambio de estado libera el inventario de todas las habitaciones (blocks_inventory = false).
    const after = await this.status.transition(
      tx,
      before,
      'CANCELLED',
      STATUS_REASON_BY_CHANNEL[command.channel],
    );
    const cancellation = await this.saveCancellation(tx, after, command);

    // T007: REMOVED con motivo CANCELLED, solo si la reserva estaba en la lista del día ya enviada.
    await this.dailyList.record(tx, before, after);

    // T009 y regla 10: la disponibilidad liberada, para el envío a Channex.
    await this.availability.record(tx, releasedAvailability(after));
    return { reservation: after, cancellation };
  }

  /** La única `Cancellation` de la reserva (regla 5), inmutable. */
  private async saveCancellation(
    tx: Transaction,
    reservation: Reservation,
    command: CancelReservationCommand,
  ): Promise<Cancellation> {
    const cancellation = Cancellation.restore({
      id: randomUUID(),
      reservationRef: reservation.reservationRef,
      cancellationDate: this.clock.now(),
      reason: command.reason,
      channel: command.channel,
      processedBy: command.processedBy,
      status: 'COMPLETED',
    });
    try {
      await this.cancellations.insert(cancellation, tx);
      return cancellation;
    } catch (error) {
      // La restricción única es el respaldo ante dos cancelaciones simultáneas (D2).
      if (error instanceof DuplicateCancellationError) {
        throw new BusinessError(
          CONCURRENT_UPDATE.code,
          CONCURRENT_UPDATE.message,
        );
      }
      throw error;
    }
  }
}

/**
 * Una marca por cada categoría de la reserva, con sus noches (`configure-ota`, B2: `dateFrom` incluido y
 * `dateTo` excluido, porque el día de salida no se ocupa). Todas las habitaciones tienen las fechas de la
 * reserva.
 */
function releasedAvailability(reservation: Reservation): AriChange[] {
  const categories = new Set(
    reservation.rooms.map((room) => room.categoryRoom),
  );
  return [...categories].map((categoryRoom) => ({
    categoryRoom,
    dateFrom: reservation.startDate,
    dateTo: reservation.endDate,
  }));
}

/**
 * Regla 1: la Recepcionista cancela solo reservas `DIRECT`; Booking, solo las suyas.
 * @throws BusinessError `OTA_RESERVATION_CANCEL_VIA_API` si la Recepcionista intenta cancelar una de OTA.
 * @throws Error si Booking cancela una directa: no debería ocurrir, porque `generate-ota-reservation` la
 * busca por su código (punto 10). Sale como `REQUEST_NOT_PROCESSED`.
 */
function checkChannel(
  reservation: Reservation,
  channel: CancellationChannel,
): void {
  if (canCancelThroughChannel(reservation.source, channel)) {
    return;
  }
  if (channel === 'RECEPTION') {
    throw new BusinessError(
      OTA_RESERVATION_CANCEL_VIA_API.code,
      OTA_RESERVATION_CANCEL_VIA_API.message,
    );
  }
  throw new Error(
    `Booking no puede cancelar la reserva directa ${reservation.reservationRef}.`,
  );
}
