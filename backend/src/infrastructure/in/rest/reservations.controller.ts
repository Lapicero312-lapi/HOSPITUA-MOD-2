import { Controller, Get, Inject, Query } from '@nestjs/common';
import {
  LIST_RESERVATIONS,
  type ListReservations,
  type ReservationListResult,
} from '../../../application/use-cases/check-view-reservation/ports/in/list-reservations.port.js';
import { ClientHeader } from './request-headers.js';
import { readReservationListQuery } from './reservation-list-query.dto.js';

/** Las rutas de reservas de `check-view-reservation` (C1 y, en sus tareas, C2 a C5). */
@Controller('reservations')
export class ReservationsController {
  constructor(
    @Inject(LIST_RESERVATIONS)
    private readonly listReservations: ListReservations,
  ) {}

  /**
   * C1, `GET /api/reservations` para la Recepcionista (`X-Client: RECEPTIONIST`): el listado con filtros,
   * orden y paginación. Los filtros se validan antes de consultar, en el orden del plan (T007). La
   * búsqueda (`search`) se valida, pero todavía no filtra: la agregan T015 y T020. El Módulo 1 tendrá su
   * propia consulta por fechas en esta misma ruta (C5, T033).
   */
  @Get()
  async list(
    @ClientHeader(['RECEPTIONIST']) _client: string,
    @Query() query: Record<string, unknown>,
  ): Promise<ReservationListResult> {
    const {
      search: _search,
      page,
      ...filters
    } = readReservationListQuery(query);
    return this.listReservations.execute(filters, page);
  }
}
