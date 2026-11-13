import { Inject, Injectable } from '@nestjs/common';
import { BusinessError } from '../../../domain/shared/business-error.js';
import { RESERVATION_NOT_FOUND } from '../../../domain/shared/error-codes.js';
import {
  RESERVATION_PAGE_SIZE,
  RESERVATION_QUERY_PORT,
  type ReservationListFilters,
  type ReservationListPage,
  type ReservationQueryPort,
} from '../../ports/out/reservation-query.port.js';
import {
  type ListReservationFilters,
  type ListReservations,
  NO_RESERVATIONS_MESSAGE,
  type ReservationListResult,
} from './ports/in/list-reservations.port.js';
import { toReservationListRow } from './reservation-list-row.js';
import { resolveSearchCriteria } from './resolve-search-criteria.js';

/**
 * El listado de reservas de la Recepcionista (plan de `check-view-reservation`, C1, T009 a T011 y "La
 * búsqueda en `listReservations`", T015, T020 y T021): una página de 10 con los filtros ya validados. Si la
 * página pedida pasa de la última, devuelve la última válida (caso borde del spec); sin resultados, la lista
 * vacía con su mensaje (FR-010). Solo lee.
 */
@Injectable()
export class ListReservationsService implements ListReservations {
  constructor(
    @Inject(RESERVATION_QUERY_PORT)
    private readonly reservations: ReservationQueryPort,
  ) {}

  async execute(
    filters: ListReservationFilters,
    page: number,
    search: string | null,
  ): Promise<ReservationListResult> {
    if (search === null) {
      return this.listPage({ ...filters, search: null }, page);
    }
    // Paso 1: los pasos 1, 2, 4, 5 y 6 del algoritmo, sin consultar la base (T006 y T021).
    const { code, fallback } = resolveSearchCriteria(search);

    // Paso 2: el código, que ignora los demás filtros (T015).
    const byCode = await this.listPage(
      { ...filters, search: { kind: 'CODE', code } },
      page,
    );
    if (byCode.totalItems > 0) {
      return byCode;
    }

    // Paso 3: sin coincidencias, el fallback (T020).
    if (fallback.kind === 'NOT_FOUND') {
      throw new BusinessError(
        RESERVATION_NOT_FOUND.code,
        RESERVATION_NOT_FOUND.message,
      );
    }
    return this.listPage({ ...filters, search: fallback }, page);
  }

  /** Una página con `filters`; si `page` pasa de la última, la última válida (T011). */
  private async listPage(
    filters: ReservationListFilters,
    page: number,
  ): Promise<ReservationListResult> {
    let current: ReservationListPage = await this.reservations.listReservations(
      filters,
      page,
    );
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
