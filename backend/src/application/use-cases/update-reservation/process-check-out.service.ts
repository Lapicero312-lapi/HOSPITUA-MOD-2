import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Reservation } from '../../../domain/reservation/reservation.js';
import {
  PROCESSED_MESSAGE_REPOSITORY,
  type ProcessedMessageRepository,
} from '../../ports/out/processed-message.repository.js';
import {
  RESERVATION_REPOSITORY,
  type ReservationRepository,
} from '../../ports/out/reservation.repository.js';
import {
  type Transaction,
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../ports/out/transaction.js';
import {
  REGISTER_GUEST_MOVEMENTS,
  type RegisterGuestMovements,
  type RegistrationSummary,
} from '../process-guest-data/ports/in/register-guest-movements.port.js';
import type {
  CheckOutNotification,
  CheckOutOutcome,
  ProcessCheckOut,
} from './ports/in/process-check-out.port.js';
import {
  RESERVATION_STATUS,
  type ReservationStatusPort,
} from './ports/in/reservation-status.port.js';
import {
  recordMessage,
  ROOM_STAY_LOG,
  summaryText,
  warnOnSequenceGap,
} from './room-stay-notification.steps.js';

/** Los mensajes del log del spec (plan, "Colas (Check-In y Check-Out)"). No llevan datos personales. */
export const CHECK_OUT_LOG = {
  ...ROOM_STAY_LOG,
  RESERVATION_WITHOUT_CHECK_IN: 'La reserva aún no registra un ingreso.',
  ROOM_WITHOUT_CHECK_IN: 'La habitación notificada aún no registra un ingreso.',
} as const;

/**
 * `ProcessCheckOut` (plan de `update-reservation`, "Check-Out (FR-017)", D4 y "Colas"). En una
 * transacción, con la reserva bloqueada (`SELECT … FOR UPDATE`), revisa en este orden:
 * 1. el `messageId` ya procesado: duplicado, se confirma sin efectos;
 * 2. la reserva existe;
 * 3. el `roomId` pertenece a la reserva;
 * 4. la habitación ya está `CHECKED_OUT`: duplicado, se confirma sin efectos;
 * 5. la reserva está en `IN_PROGRESS`;
 * 6. la habitación está en `CHECKED_IN`.
 *
 * Si 2, 3, 5 o 6 fallan, no cambia nada, lo deja en el log y registra el mensaje con su `sequenceNumber`
 * (punto 6 del plan). Si pasa todo: `CHECKED_IN → CHECKED_OUT`; si ya no queda ninguna habitación en
 * `EXPECTED` ni en `CHECKED_IN`, la reserva `IN_PROGRESS → COMPLETED`; los huéspedes con
 * `RegisterGuestMovements` (`DEPARTURE`) y el `messageId` en `processed_message`, todo en la misma
 * transacción. No modifica el estado de la `Room`, que es del Módulo 1, ni avisa a la lista del día.
 */
@Injectable()
export class ProcessCheckOutService implements ProcessCheckOut {
  private readonly logger = new Logger(ProcessCheckOutService.name);

  constructor(
    @Inject(TRANSACTION_RUNNER)
    private readonly transactions: TransactionRunner,
    @Inject(RESERVATION_REPOSITORY)
    private readonly reservations: ReservationRepository,
    @Inject(PROCESSED_MESSAGE_REPOSITORY)
    private readonly processedMessages: ProcessedMessageRepository,
    @Inject(RESERVATION_STATUS)
    private readonly status: ReservationStatusPort,
    @Inject(REGISTER_GUEST_MOVEMENTS)
    private readonly guests: RegisterGuestMovements,
  ) {}

  execute(notification: CheckOutNotification): Promise<CheckOutOutcome> {
    return this.transactions.run((tx) => this.process(tx, notification));
  }

  private async process(
    tx: Transaction,
    notification: CheckOutNotification,
  ): Promise<CheckOutOutcome> {
    const { messageId, reservationRef, roomId } = notification;
    const where = `reserva ${reservationRef}, habitación ${roomId}`;
    const reservation = await this.reservations.lockByRef(reservationRef, tx);

    // 1. El mismo mensaje otra vez.
    if (await this.processedMessages.isProcessed(messageId, tx)) {
      this.logger.log(
        `Check-Out repetido (${where}): el mensaje ya se procesó y se confirma sin cambios.`,
      );
      return 'DUPLICATE';
    }
    await warnOnSequenceGap(
      this.processedMessages,
      this.logger,
      tx,
      notification,
    );

    // 2, 3 y 4.
    if (reservation === null) {
      return this.reject(tx, notification, CHECK_OUT_LOG.RESERVATION_NOT_FOUND);
    }
    const room = reservation.rooms.find(
      (candidate) => candidate.roomId === roomId,
    );
    if (room === undefined) {
      return this.reject(
        tx,
        notification,
        CHECK_OUT_LOG.ROOM_NOT_IN_RESERVATION,
      );
    }
    if (room.stayStatus === 'CHECKED_OUT') {
      this.logger.log(
        `Check-Out repetido (${where}): la habitación ya está en CHECKED_OUT y se confirma sin cambios.`,
      );
      return 'DUPLICATE';
    }

    // 5 y 6.
    if (reservation.status !== 'IN_PROGRESS') {
      return this.reject(
        tx,
        notification,
        `${CHECK_OUT_LOG.RESERVATION_WITHOUT_CHECK_IN} Está en ${reservation.status}.`,
      );
    }
    if (room.stayStatus !== 'CHECKED_IN') {
      return this.reject(
        tx,
        notification,
        `${CHECK_OUT_LOG.ROOM_WITHOUT_CHECK_IN} Está en ${room.stayStatus}.`,
      );
    }

    const summary = await this.apply(tx, reservation, notification);
    await recordMessage(this.processedMessages, tx, notification);
    this.logger.log(`Check-Out aplicado (${where}): ${summaryText(summary)}`);
    return 'APPLIED';
  }

  /**
   * La habitación a `CHECKED_OUT`; la reserva a `COMPLETED` si ya no queda ninguna habitación en
   * `EXPECTED` ni en `CHECKED_IN` (las `NOT_ARRIVED` no cuentan); y los huéspedes.
   */
  private async apply(
    tx: Transaction,
    reservation: Reservation,
    notification: CheckOutNotification,
  ): Promise<RegistrationSummary> {
    let current = await this.status.transitionStay(
      tx,
      reservation,
      notification.roomId,
      'CHECKED_OUT',
    );
    const stillInStay = current.rooms.some(
      ({ stayStatus }) =>
        stayStatus === 'EXPECTED' || stayStatus === 'CHECKED_IN',
    );
    if (!stillInStay) {
      current = await this.status.transition(
        tx,
        current,
        'COMPLETED',
        'CHECK_OUT',
      );
    }
    return this.guests.register(tx, {
      reservationId: current.id,
      roomId: notification.roomId,
      movementType: 'DEPARTURE',
      movementDate: notification.movementDate,
      guests: notification.guests,
    });
  }

  /** No cambia nada, lo deja en el log y registra el mensaje para el control de secuencia. */
  private async reject(
    tx: Transaction,
    notification: CheckOutNotification,
    reason: string,
  ): Promise<CheckOutOutcome> {
    this.logger.warn(
      `Check-Out rechazado (reserva ${notification.reservationRef}, habitación ${notification.roomId}): ${reason}`,
    );
    await recordMessage(this.processedMessages, tx, notification);
    return 'REJECTED';
  }
}
