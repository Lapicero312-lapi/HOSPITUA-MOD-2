import { Inject, Injectable } from '@nestjs/common';
import {
  RESERVATION_QUERY_PORT,
  type ReservationQueryPort,
  type StayRangeReservation,
} from '../../ports/out/reservation-query.port.js';
import type {
  FindReservationsByStayRange,
  StayRangeQuery,
} from './ports/in/find-reservations-by-stay-range.port.js';

/**
 * La consulta de reservas por fechas del Módulo 1 (plan, C5 y "Consulta del Módulo 1"; FR-023, T033). La
 * consulta ya llega revisada por el DTO del Módulo 1; aquí solo se lee.
 */
@Injectable()
export class FindReservationsByStayRangeService implements FindReservationsByStayRange {
  constructor(
    @Inject(RESERVATION_QUERY_PORT)
    private readonly reservations: ReservationQueryPort,
  ) {}

  execute(query: StayRangeQuery): Promise<StayRangeReservation[]> {
    return this.reservations.findByStayRange(
      query.dateFrom,
      query.dateTo,
      query.roomId,
    );
  }
}
