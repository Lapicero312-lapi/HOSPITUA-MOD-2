import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  DailyListMembership,
  type DailyListChange,
} from '../../../domain/reservation/daily-list-membership.js';
import type { ReservationProjection } from '../../../domain/reservation/reservation-projection.js';
import type { Reservation } from '../../../domain/reservation/reservation.js';
import { CLOCK, type Clock } from '../../ports/out/clock.js';
import {
  DAILY_MESSAGE_REPOSITORY,
  type DailyMessageRepository,
} from '../../ports/out/daily-message.repository.js';
import {
  DAILY_SEQUENCE_REPOSITORY,
  type DailySequenceRepository,
} from '../../ports/out/daily-sequence.repository.js';
import {
  OTA_REPOSITORY,
  type OtaRepository,
} from '../../ports/out/ota.repository.js';
import {
  TRANSACTION_RUNNER,
  type Transaction,
  type TransactionRunner,
} from '../../ports/out/transaction.js';
import { messageProjection } from './message-projection.js';
import { colombiaTime } from './message-time.js';
import type { DailyListChangeRecorder } from './ports/in/daily-list-change-recorder.port.js';
import {
  PUBLISH_PENDING_DAILY_MESSAGES,
  type PublishPendingDailyMessages,
} from './ports/in/publish-pending-daily-messages.port.js';

/**
 * Deja en `daily_list_message` la actualización `ADDED`, `UPDATED` o `REMOVED` que genera el cambio de una
 * reserva (plan, "Anotar un cambio"). Todo pasa en la transacción de quien llama: el bloqueo de la fila
 * del día, la secuencia y el mensaje se confirman o se revierten junto con el cambio de la reserva.
 */
@Injectable()
export class DailyListChangeRecorderService implements DailyListChangeRecorder {
  constructor(
    @Inject(DAILY_SEQUENCE_REPOSITORY)
    private readonly sequences: DailySequenceRepository,
    @Inject(DAILY_MESSAGE_REPOSITORY)
    private readonly messages: DailyMessageRepository,
    @Inject(OTA_REPOSITORY)
    private readonly otas: OtaRepository,
    @Inject(CLOCK)
    private readonly clock: Clock,
    @Inject(TRANSACTION_RUNNER)
    private readonly transactions: TransactionRunner,
    @Inject(PUBLISH_PENDING_DAILY_MESSAGES)
    private readonly publication: PublishPendingDailyMessages,
  ) {}

  async record(
    tx: Transaction,
    before: Reservation | null,
    after: Reservation,
    operationalDate: string = this.clock.today(),
  ): Promise<void> {
    // El bloqueo va primero: un cambio simultáneo espera aquí y toma la secuencia siguiente. La fila se crea
    // si no existe, para que la lista de las 00:00 y un cambio se pongan en fila aunque no haya ninguna.
    const day = await this.sequences.lockOrCreateDay(operationalDate, tx);
    if (!day.listGenerated) {
      // La lista todavía no sale: la incluirá con los datos vigentes.
      return;
    }
    const change = DailyListMembership.evaluate(before, after, operationalDate);
    if (change === null) {
      return;
    }
    // Un REMOVED no lleva la reserva.
    const reservation =
      change.updateType === 'REMOVED'
        ? null
        : await this.projectionOf(after, tx);
    const sequenceNumber = day.lastSequence + 1;
    await this.sequences.setLastSequence(operationalDate, sequenceNumber, tx);
    const messageId = randomUUID();
    await this.messages.insert(
      {
        messageId,
        operationalDate,
        sequenceNumber,
        kind: 'UPDATE',
        updateType: change.updateType,
        reservationId: after.id,
        removalReason:
          change.updateType === 'REMOVED' ? change.removalReason : null,
        payload: {
          messageId,
          sequenceNumber,
          operationalDate,
          updateType: change.updateType,
          occurredAt: colombiaTime(this.clock.now()),
          reservationRef: after.reservationRef,
          ...detailOf(change, reservation),
        },
      },
      tx,
    );
    // La publicación inmediata, apenas se confirme el cambio que lo originó (T029, NFR-005).
    this.transactions.afterCommit(tx, () => this.publication.execute());
  }

  /** El detalle de FR-014 tal como viaja: con el nombre de la agencia y `updatedAt` en hora de Colombia. */
  private async projectionOf(
    reservation: Reservation,
    tx: Transaction,
  ): Promise<ReservationProjection> {
    let otaName: string | null = null;
    if (reservation.ota !== null) {
      const ota = await this.otas.findById(reservation.ota.otaId, tx);
      if (ota === null) {
        throw new Error(
          `La agencia de la reserva ${reservation.reservationRef} no existe.`,
        );
      }
      otaName = ota.name;
    }
    return messageProjection(reservation, otaName);
  }
}

/** Lo que va después de `reservationRef`: la reserva en `ADDED` y `UPDATED`, el motivo en `REMOVED`. */
function detailOf(
  change: DailyListChange,
  reservation: ReservationProjection | null,
): object {
  return change.updateType === 'REMOVED'
    ? { removalReason: change.removalReason }
    : { reservation };
}
