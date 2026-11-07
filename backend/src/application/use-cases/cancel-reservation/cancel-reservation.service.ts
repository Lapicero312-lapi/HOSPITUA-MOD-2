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
import {
  CANCELLATION_REPOSITORY,
  DuplicateCancellationError,
  type CancellationRepository,
} from '../../ports/out/cancellation.repository.js';
import { CLOCK, type Clock } from '../../ports/out/clock.js';
import type { Transaction } from '../../ports/out/transaction.js';
import {
  DAILY_LIST_CHANGE_RECORDER,
  type DailyListChangeRecorder,
} from '../check-view-reservation/ports/in/daily-list-change-recorder.port.js';
import {
  RESERVATION_LOOKUP,
  type ReservationLookup,
} from '../check-view-reservation/ports/in/reservation-lookup.port.js';
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
 * `CancelReservation` (plan de `cancel-reservation`, regla 3 y punto 10; T005 a T007). Usa los puertos de
 * entrada de `check-view-reservation` y `update-reservation` (regla 6), y todo va en la transacción de
 * quien llama: si algo falla, no queda nada a medias (regla 4).
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
  ) {}

  async cancel(
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
    // concurrencia del spec, no el del estado.
    if (
      command.expectedUpdatedAt !== undefined &&
      (before.updatedAt === null ||
        !isSameInstant(command.expectedUpdatedAt, before.updatedAt))
    ) {
      throw new BusinessError(
        CONCURRENT_UPDATE.code,
        CONCURRENT_UPDATE.message,
      );
    }

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
    await this.saveCancellation(tx, after, command);

    // T007: REMOVED con motivo CANCELLED, solo si la reserva estaba en la lista del día ya enviada.
    await this.dailyList.record(tx, before, after);
    return after;
  }

  /** La única `Cancellation` de la reserva (regla 5), inmutable. */
  private async saveCancellation(
    tx: Transaction,
    reservation: Reservation,
    command: CancelReservationCommand,
  ): Promise<void> {
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
