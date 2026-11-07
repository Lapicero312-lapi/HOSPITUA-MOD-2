import { Inject, Injectable } from '@nestjs/common';
import {
  RESERVATION_PAGE_SIZE,
  RESERVATION_QUERY_PORT,
  type ReservationListFilters,
  type ReservationQueryPort,
} from '../../ports/out/reservation-query.port.js';
import {
  NO_RESERVATIONS_MESSAGE,
  type ListReservations,
  type ReservationListResult,
} from './ports/in/list-reservations.port.js';
import { toReservationListRow } from './reservation-list-row.js';

/**
 * El listado de reservas de la Recepcionista (plan de `check-view-reservation`, C1, T009 a T011): una
 * página de 10 con los filtros ya validados. Si la página pedida pasa de la última, devuelve la última
 * válida (caso borde del spec); sin resultados, la lista vacía con su mensaje (FR-010). Solo lee.
 */
@Injectable()
export class ListReservationsService implements ListReservations {
  constructor(
    @Inject(RESERVATION_QUERY_PORT)
    private readonly reservations: ReservationQueryPort,
  ) {}

  async execute(
    filters: ReservationListFilters,
    page: number,
  ): Promise<ReservationListResult> {
    let current = await this.reservations.listReservations(filters, page);
    const totalPages = Math.ceil(current.totalItems / RESERVATION_PAGE_SIZE);
    let returnedPage = page;
    if (current.totalItems === 0) {
      // No hay ninguna página válida: se informa la primera, vacía.
      returnedPage = 1;
    } else if (page > totalPages) {
      returnedPage = totalPages;
      current = await this.reservations.listReservations(filters, totalPages);
    }
    return {
      items: current.items.map(toReservationListRow),
      page: returnedPage,
      pageSize: RESERVATION_PAGE_SIZE,
      totalItems: current.totalItems,
      totalPages,
      message: current.totalItems === 0 ? NO_RESERVATIONS_MESSAGE : null,
    };
  }
}
