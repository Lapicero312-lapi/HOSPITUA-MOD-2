import { Inject, Injectable } from '@nestjs/common';
import type { GuestStay } from '../../../domain/migration/guest-stay.js';
import { isForeign } from '../../../domain/migration/is-foreign.js';
import { CLOCK, type Clock } from '../../ports/out/clock.js';
import {
  GUEST_STAY_QUERY,
  type GuestStayCriteria,
  type GuestStayQuery,
  type GuestStayRow,
} from '../../ports/out/guest-stay.query.js';
import type { GuestStayFilters } from './guest-stay-filters.validator.js';
import {
  GUEST_STAYS_PAGE_SIZE,
  NO_GUEST_STAYS_MESSAGE,
  type GuestStayPage,
  type ListGuestStays,
} from './ports/in/list-guest-stays.port.js';

/**
 * `ListGuestStays` (plan, C1 y D3): cuenta las filas con los filtros, ajusta la página a la última válida
 * y trae esa página. Una estadía sin salida queda abierta hasta el día operativo del `Clock` (punto 5).
 */
@Injectable()
export class ListGuestStaysService implements ListGuestStays {
  constructor(
    @Inject(GUEST_STAY_QUERY)
    private readonly query: GuestStayQuery,
    @Inject(CLOCK)
    private readonly clock: Clock,
  ) {}

  async execute(filters: GuestStayFilters): Promise<GuestStayPage> {
    const criteria: GuestStayCriteria = {
      nationality: filters.nationality,
      presence: filters.presence,
      dateRange: filters.dateRange,
      search: filters.search,
      today: this.clock.today(),
    };
    const totalItems = await this.query.count(criteria);
    if (totalItems === 0) {
      return {
        items: [],
        page: 1,
        pageSize: GUEST_STAYS_PAGE_SIZE,
        totalItems: 0,
        totalPages: 0,
        message: NO_GUEST_STAYS_MESSAGE,
      };
    }
    const totalPages = Math.ceil(totalItems / GUEST_STAYS_PAGE_SIZE);
    // Una página que no existe se ajusta a la última válida.
    const page = Math.min(filters.page, totalPages);
    const rows = await this.query.findPage(
      criteria,
      (page - 1) * GUEST_STAYS_PAGE_SIZE,
      GUEST_STAYS_PAGE_SIZE,
    );
    return {
      items: rows.map(toGuestStay),
      page,
      pageSize: GUEST_STAYS_PAGE_SIZE,
      totalItems,
      totalPages,
      message: null,
    };
  }
}

/** La fila de C1: la marca de extranjero (punto 8) y "En el hotel" con entrada y sin salida (FR-011). */
function toGuestStay(row: GuestStayRow): GuestStay {
  return {
    reservationRef: row.reservationRef,
    guest: {
      firstName: row.firstName,
      lastName: row.lastName,
      documentType: row.documentType,
      documentNumber: row.documentNumber,
      nationality: row.nationality,
      isForeign: isForeign(row.nationality),
    },
    entryDate: row.entryDate,
    exitDate: row.exitDate,
    inHotel: row.entryDate !== null && row.exitDate === null,
  };
}
