import { Inject, Injectable } from '@nestjs/common';
import {
  OTA_COMMISSION_PAGE_SIZE,
  type OtaCommissionRows,
  RESERVATION_QUERY_PORT,
  type ReservationQueryPort,
} from '../../ports/out/reservation-query.port.js';
import type {
  ListOtaCommissions,
  OtaCommissionFilters,
  OtaCommissionPage,
} from './ports/in/list-ota-commissions.port.js';

/**
 * A1 (plan, punto C1; T011): una página de 100 de las reservas OTA del periodo. Si la página pedida pasa de
 * la última, devuelve la última válida, como C1 de `check-view-reservation`; sin resultados, `items`
 * vacío en la página 1.
 */
@Injectable()
export class ListOtaCommissionsService implements ListOtaCommissions {
  constructor(
    @Inject(RESERVATION_QUERY_PORT)
    private readonly reservations: ReservationQueryPort,
  ) {}

  async execute(
    filters: OtaCommissionFilters,
    page: number,
  ): Promise<OtaCommissionPage> {
    let current: OtaCommissionRows = await this.reservations.listOtaCommissions(
      filters,
      page,
    );
    const totalPages = Math.ceil(current.totalItems / OTA_COMMISSION_PAGE_SIZE);
    let returnedPage = page;
    if (current.totalItems === 0) {
      returnedPage = 1;
    } else if (page > totalPages) {
      returnedPage = totalPages;
      current = await this.reservations.listOtaCommissions(filters, totalPages);
    }
    return {
      items: current.items,
      page: returnedPage,
      pageSize: OTA_COMMISSION_PAGE_SIZE,
      totalItems: current.totalItems,
      totalPages,
    };
  }
}
