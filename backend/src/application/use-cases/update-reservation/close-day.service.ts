import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Reservation } from '../../../domain/reservation/reservation.js';
import { BusinessError } from '../../../domain/shared/business-error.js';
import { CLOCK, type Clock } from '../../ports/out/clock.js';
import {
  IDEMPOTENCY_KEY_REPOSITORY,
  type IdempotencyKeyRepository,
} from '../../ports/out/idempotency-key.repository.js';
import {
  RESERVATION_QUERY_PORT,
  type ReservationQueryPort,
} from '../../ports/out/reservation-query.port.js';
import {
  RESERVATION_REPOSITORY,
  type ReservationRepository,
} from '../../ports/out/reservation.repository.js';
import {
  TRANSACTION_RUNNER,
  type Transaction,
  type TransactionRunner,
} from '../../ports/out/transaction.js';
import {
  DAILY_LIST_CHANGE_RECORDER,
  type DailyListChangeRecorder,
} from '../check-view-reservation/ports/in/daily-list-change-recorder.port.js';
import {
  OTA_NO_SHOW_REPORTER,
  type OtaNoShowReporter,
} from '../generate-ota-reservation/ports/in/ota-no-show-reporter.port.js';
import {
  CLOSE_DAY_BATCH_SIZE,
  type CloseDay,
  type CloseDaySummary,
} from './ports/in/close-day.port.js';
import {
  RESERVATION_STATUS,
  type ReservationStatusPort,
} from './ports/in/reservation-status.port.js';

/** Lo que pasó con una reserva: la cifra del resumen que suma. */
type Outcome = 'noShow' | 'notArrived' | 'completed' | 'ignored';

/**
 * El cierre del día operativo (plan, "Cierre del día", D5 y punto 13; FR-018 a FR-022), por lotes de
 * `CLOSE_DAY_BATCH_SIZE` y con una transacción por reserva.
 */
@Injectable()
export class CloseDayService implements CloseDay {
  private readonly logger = new Logger(CloseDayService.name);

  constructor(
    @Inject(RESERVATION_QUERY_PORT)
    private readonly query: ReservationQueryPort,
    @Inject(RESERVATION_REPOSITORY)
    private readonly reservations: ReservationRepository,
    @Inject(RESERVATION_STATUS)
    private readonly status: ReservationStatusPort,
    @Inject(DAILY_LIST_CHANGE_RECORDER)
    private readonly dailyList: DailyListChangeRecorder,
    @Inject(OTA_NO_SHOW_REPORTER)
    private readonly noShows: OtaNoShowReporter,
    @Inject(TRANSACTION_RUNNER)
    private readonly transactions: TransactionRunner,
    @Inject(CLOSE_DAY_BATCH_SIZE)
    private readonly batchSize: number,
    @Inject(IDEMPOTENCY_KEY_REPOSITORY)
    private readonly idempotencyKeys: IdempotencyKeyRepository,
    @Inject(CLOCK)
    private readonly clock: Clock,
  ) {}

  async closePendingDays(today: string): Promise<CloseDaySummary[]> {
    const summaries: CloseDaySummary[] = [];
    for (const operationalDate of await this.query.findDaysToClose(today)) {
      // Uno a la vez y en orden: si uno se detiene, los siguientes esperan a la próxima ejecución.
      summaries.push(await this.execute(operationalDate));
    }
    return summaries;
  }

  async execute(operationalDate: string): Promise<CloseDaySummary> {
    const summary: CloseDaySummary = {
      operationalDate,
      noShow: 0,
      notArrived: 0,
      completed: 0,
      ignored: 0,
      failed: 0,
    };
    let afterRef: string | null = null;
    for (;;) {
      // Un error aquí (la base de datos no responde) detiene el cierre: lo maneja CloseDayJob (T022).
      const refs = await this.query.findToClose(
        operationalDate,
        afterRef,
        this.batchSize,
      );
      for (const ref of refs) {
        try {
          const outcome = await this.transactions.run((tx) =>
            this.close(tx, ref, operationalDate),
          );
          summary[outcome] += 1;
        } catch (error) {
          // FR-022: se revierte solo esta reserva y se sigue con la siguiente. Sin datos personales.
          summary.failed += 1;
          this.logger.warn(
            `La reserva ${ref} no se pudo cerrar el día ${operationalDate} y se sigue con la siguiente: ${reasonOf(error)}`,
          );
        }
      }
      if (refs.length < this.batchSize) {
        break;
      }
      afterRef = refs[refs.length - 1];
    }
    await this.deleteExpiredIdempotencyKeys();
    this.logger.log(
      `Cierre del día ${operationalDate}: ${summary.noShow} No-Show, ${summary.notArrived} con habitaciones sin llegar, ${summary.completed} completadas, ${summary.ignored} ignoradas y ${summary.failed} con error.`,
    );
    return summary;
  }

  /**
   * Al terminar, borra las `Idempotency-Key` de más de 24 horas (punto 13; punto 15 de
   * `generate-direct-reservation`, T019). Si falla, solo queda en el log: el cierre ya terminó.
   */
  private async deleteExpiredIdempotencyKeys(): Promise<void> {
    try {
      await this.idempotencyKeys.deleteExpired(
        new Date(this.clock.now().getTime() - IDEMPOTENCY_TTL_MS),
      );
    } catch (error) {
      this.logger.warn(
        `No se pudieron borrar las Idempotency-Key vencidas: ${reasonOf(error)}`,
      );
    }
  }

  /** Una reserva, en su transacción: la bloquea, vuelve a revisarla y la cierra según su estado. */
  private async close(
    tx: Transaction,
    ref: string,
    operationalDate: string,
  ): Promise<Outcome> {
    const reservation = await this.reservations.lockByRef(ref, tx);
    // Pudo cambiar entre la selección y el bloqueo (otra fecha, cancelada, ya cerrada).
    if (reservation === null || reservation.startDate !== operationalDate) {
      return 'ignored';
    }
    switch (reservation.status) {
      case 'ACTIVE':
      case 'PENDING':
        return this.noShow(tx, reservation, operationalDate);
      case 'IN_PROGRESS':
        return this.partialArrival(tx, reservation);
      default:
        return 'ignored';
    }
  }

  /**
   * FR-019 y FR-021: `NO_SHOW`, con todas sus habitaciones `NOT_ARRIVED` y sin `Cancellation`; el aviso a la
   * lista del día cerrado (T023); y, si es de Booking, el reporte pendiente del no-show.
   */
  private async noShow(
    tx: Transaction,
    reservation: Reservation,
    operationalDate: string,
  ): Promise<Outcome> {
    const after = await this.status.transition(
      tx,
      reservation,
      'NO_SHOW',
      'DAY_CLOSE_NO_SHOW',
    );
    await this.dailyList.record(tx, reservation, after, operationalDate);
    if (after.source === 'OTA') {
      await this.noShows.record(tx, after);
    }
    return 'noShow';
  }

  /**
   * FR-019: las habitaciones en `EXPECTED` pasan a `NOT_ARRIVED`; si ya no queda ninguna `CHECKED_IN`, la
   * reserva pasa a `COMPLETED`. No avisa a la lista: la reserva `IN_PROGRESS` ya no está en ella.
   */
  private async partialArrival(
    tx: Transaction,
    reservation: Reservation,
  ): Promise<Outcome> {
    if (
      !reservation.rooms.some(({ stayStatus }) => stayStatus === 'EXPECTED')
    ) {
      // Escenario 4: todo el grupo ingresó.
      return 'ignored';
    }
    const after = await this.status.markNotArrived(tx, reservation);
    if (after.rooms.some(({ stayStatus }) => stayStatus === 'CHECKED_IN')) {
      return 'notArrived';
    }
    await this.status.transition(tx, after, 'COMPLETED', 'DAY_CLOSE_PARTIAL');
    return 'completed';
  }
}

/** Cuánto vive una `Idempotency-Key` (D16 del plan base). */
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/** El motivo de un fallo para el log: el código de negocio o el tipo y el mensaje del error. */
function reasonOf(error: unknown): string {
  if (error instanceof BusinessError) {
    return `${error.errorCode}: ${error.message}`;
  }
  return error instanceof Error
    ? `${error.name}: ${error.message}`
    : 'error desconocido';
}
