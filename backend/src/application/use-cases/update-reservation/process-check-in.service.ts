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
  CheckInNotification,
  CheckInOutcome,
  ProcessCheckIn,
} from './ports/in/process-check-in.port.js';
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
export const CHECK_IN_LOG = {
  ...ROOM_STAY_LOG,
  STATUS_NOT_ALLOWED: 'La reserva no admite un Check-In en su estado actual.',
} as const;

/**
 * `ProcessCheckIn` (plan de `update-reservation`, "Check-In (FR-015)", D3 y "Colas"). En una transacción,
 * con la reserva bloqueada (`SELECT … FOR UPDATE`), revisa en este orden:
 * 1. el `messageId` ya procesado: duplicado, se confirma sin efectos;
 * 2. la reserva existe;
 * 3. el `roomId` pertenece a la reserva;
 * 4. la habitación ya está `CHECKED_IN`: duplicado, se confirma sin efectos en la reserva y registra el
 *    mensaje con su `sequenceNumber` (punto 6 del plan);
 * 5. la reserva está en `ACTIVE` o `IN_PROGRESS`;
 * 6. la habitación está en `EXPECTED`.
 *
 * Si 2, 3, 5 o 6 fallan, no cambia nada, lo deja en el log y registra el mensaje con su `sequenceNumber`
 * (punto 6 del plan: así no se marcan saltos falsos). Si pasa todo: `EXPECTED → CHECKED_IN`, la reserva
 * `ACTIVE → IN_PROGRESS` si es la primera habitación, los huéspedes con `RegisterGuestMovements` y el
 * `messageId` en `processed_message`, todo en la misma transacción. No avisa a la lista del día.
 */
@Injectable()
export class ProcessCheckInService implements ProcessCheckIn {
  private readonly logger = new Logger(ProcessCheckInService.name);

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

  execute(notification: CheckInNotification): Promise<CheckInOutcome> {
    return this.transactions.run((tx) => this.process(tx, notification));
  }

  private async process(
    tx: Transaction,
    notification: CheckInNotification,
  ): Promise<CheckInOutcome> {
    const { messageId, reservationRef, roomId } = notification;
    const where = `reserva ${reservationRef}, habitación ${roomId}`;
    const reservation = await this.reservations.lockByRef(reservationRef, tx);

    // 1. El mismo mensaje otra vez.
    if (await this.processedMessages.isProcessed(messageId, tx)) {
      this.logger.log(
        `Check-In repetido (${where}): el mensaje ya se procesó y se confirma sin cambios.`,
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
      return this.reject(tx, notification, CHECK_IN_LOG.RESERVATION_NOT_FOUND);
    }
    const room = reservation.rooms.find(
      (candidate) => candidate.roomId === roomId,
    );
    if (room === undefined) {
      return this.reject(
        tx,
        notification,
        CHECK_IN_LOG.ROOM_NOT_IN_RESERVATION,
      );
    }
    if (room.stayStatus === 'CHECKED_IN') {
      this.logger.log(
        `Check-In repetido (${where}): la habitación ya está en CHECKED_IN y se confirma sin cambios.`,
      );
      await recordMessage(this.processedMessages, tx, notification);
      return 'DUPLICATE';
    }

    // 5 y 6.
    if (
      reservation.status !== 'ACTIVE' &&
      reservation.status !== 'IN_PROGRESS'
    ) {
      return this.reject(
        tx,
        notification,
        `${CHECK_IN_LOG.STATUS_NOT_ALLOWED} Está en ${reservation.status}.`,
      );
    }
    if (room.stayStatus !== 'EXPECTED') {
      return this.reject(
        tx,
        notification,
        `La habitación notificada no admite un Check-In: está en ${room.stayStatus}.`,
      );
    }

    const summary = await this.apply(tx, reservation, notification);
    await recordMessage(this.processedMessages, tx, notification);
    this.logger.log(`Check-In aplicado (${where}): ${summaryText(summary)}`);
    return 'APPLIED';
  }

  /** La habitación a `CHECKED_IN`, la reserva a `IN_PROGRESS` si es la primera, y los huéspedes. */
  private async apply(
    tx: Transaction,
    reservation: Reservation,
    notification: CheckInNotification,
  ): Promise<RegistrationSummary> {
    let current = await this.status.transitionStay(
      tx,
      reservation,
      notification.roomId,
      'CHECKED_IN',
    );
    if (current.status === 'ACTIVE') {
      current = await this.status.transition(
        tx,
        current,
        'IN_PROGRESS',
        'CHECK_IN',
      );
    }
    return this.guests.register(tx, {
      reservationId: current.id,
      roomId: notification.roomId,
      movementType: 'ENTRY',
      movementDate: notification.movementDate,
      guests: notification.guests,
    });
  }

  /** No cambia nada, lo deja en el log y registra el mensaje para el control de secuencia. */
  private async reject(
    tx: Transaction,
    notification: CheckInNotification,
    reason: string,
  ): Promise<CheckInOutcome> {
    this.logger.warn(
      `Check-In rechazado (reserva ${notification.reservationRef}, habitación ${notification.roomId}): ${reason}`,
    );
    await recordMessage(this.processedMessages, tx, notification);
    return 'REJECTED';
  }
}
