import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { DailyListMembership } from '../../../domain/reservation/daily-list-membership.js';
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
  RESERVATION_QUERY_PORT,
  type ReservationQueryPort,
} from '../../ports/out/reservation-query.port.js';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../ports/out/transaction.js';
import { messageProjection } from './message-projection.js';
import { colombiaTime } from './message-time.js';
import type { GenerateDailyList } from './ports/in/generate-daily-list.port.js';

/** La lista siempre es el primer mensaje del día (plan, "Mensajería hacia el Módulo 1"). */
const LIST_SEQUENCE = 1;

/**
 * `GenerateDailyList` (plan, "Generar la lista del día", T023). El bloqueo de la fila del día va primero:
 * un cambio de reserva simultáneo espera aquí, y como las llegadas se leen después, ningún cambio queda
 * entre la lista y su primera actualización ("Por qué hace falta `daily_sequence`").
 */
@Injectable()
export class GenerateDailyListService implements GenerateDailyList {
  constructor(
    @Inject(TRANSACTION_RUNNER)
    private readonly transactions: TransactionRunner,
    @Inject(DAILY_SEQUENCE_REPOSITORY)
    private readonly sequences: DailySequenceRepository,
    @Inject(RESERVATION_QUERY_PORT)
    private readonly query: ReservationQueryPort,
    @Inject(DAILY_MESSAGE_REPOSITORY)
    private readonly messages: DailyMessageRepository,
    @Inject(CLOCK)
    private readonly clock: Clock,
  ) {}

  execute(operationalDate: string = this.clock.today()): Promise<boolean> {
    return this.transactions.run(async (tx) => {
      // Paso 1: la fila del día, creada si no existe y bloqueada hasta el final.
      const day = await this.sequences.lockOrCreateDay(operationalDate, tx);
      if (day.listGenerated) {
        // Una ejecución repetida no hace nada (historia 4, escenario 4).
        return false;
      }
      // Pasos 2 y 3: las llegadas confirmadas, después del bloqueo; solo las que pertenecen a la lista.
      const arrivals = await this.query.findArrivals(operationalDate, tx);
      const reservations = arrivals
        .filter(({ reservation }) =>
          DailyListMembership.belongs(reservation, operationalDate),
        )
        .map(({ reservation, otaName }) =>
          messageProjection(reservation, otaName),
        );

      // Paso 4: el payload de "Lista del día".
      const messageId = randomUUID();
      const payload = {
        messageId,
        sequenceNumber: LIST_SEQUENCE,
        operationalDate,
        generatedAt: colombiaTime(this.clock.now()),
        totalReservations: reservations.length,
        totalRooms: reservations.reduce(
          (total, reservation) => total + reservation.rooms.length,
          0,
        ),
        totalGuests: reservations.reduce(
          (total, reservation) => total + reservation.guestCount,
          0,
        ),
        reservations,
      };

      // Paso 5: el mensaje en PENDING y la fila del día marcada, en la misma transacción.
      await this.messages.insert(
        {
          messageId,
          operationalDate,
          sequenceNumber: LIST_SEQUENCE,
          kind: 'LIST',
          updateType: null,
          reservationId: null,
          removalReason: null,
          payload,
        },
        tx,
      );
      await this.sequences.markListGenerated(operationalDate, tx);
      return true;
    });
  }
}
