import { Controller, Get, Inject, Query } from '@nestjs/common';
import { readGuestStayFilters } from '../../../application/use-cases/process-guest-data/guest-stay-filters.validator.js';
import {
  LIST_GUEST_STAYS,
  type GuestStayPage,
  type ListGuestStays,
} from '../../../application/use-cases/process-guest-data/ports/in/list-guest-stays.port.js';

/** La vista de huéspedes alojados de la Recepcionista (plan de `process-guest-data`, C). Solo lectura. */
@Controller('guest-stays')
export class GuestStaysController {
  constructor(
    @Inject(LIST_GUEST_STAYS)
    private readonly listGuestStays: ListGuestStays,
  ) {}

  /**
   * C1, `GET /api/guest-stays`: revisa los filtros antes de consultar (D3) y devuelve la página. Con un
   * filtro inválido, el filtro global responde 400 con el código del validador.
   */
  @Get()
  async list(
    @Query('nationality') nationality: unknown,
    @Query('presence') presence: unknown,
    @Query('dateFrom') dateFrom: unknown,
    @Query('dateTo') dateTo: unknown,
    @Query('search') search: unknown,
    @Query('page') page: unknown,
  ): Promise<GuestStayPage> {
    const filters = readGuestStayFilters({
      nationality,
      presence,
      dateFrom,
      dateTo,
      search,
      page,
    });
    return this.listGuestStays.execute(filters);
  }
}
