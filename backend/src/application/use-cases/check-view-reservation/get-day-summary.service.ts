import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../../ports/out/clock.js';
import {
  RESERVATION_QUERY_PORT,
  type ReservationQueryPort,
} from '../../ports/out/reservation-query.port.js';
import type {
  DaySummary,
  GetDaySummary,
} from './ports/in/get-day-summary.port.js';

/**
 * El resumen del día operativo (plan de `check-view-reservation`, C2; FR-005a): las llegadas y salidas
 * esperadas, contadas por reserva y solo con datos del Módulo 2. Nunca ocupación física. Solo lee.
 */
@Injectable()
export class GetDaySummaryService implements GetDaySummary {
  constructor(
    @Inject(RESERVATION_QUERY_PORT)
    private readonly reservations: ReservationQueryPort,
    @Inject(CLOCK)
    private readonly clock: Clock,
  ) {}

  async execute(): Promise<DaySummary> {
    const operationalDate = this.clock.today();
    const expected =
      await this.reservations.countExpectedArrivalsAndDepartures(
        operationalDate,
      );
    return { operationalDate, ...expected };
  }
}
