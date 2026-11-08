import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import {
  GET_RESERVATION_DETAIL,
  type GetReservationDetail,
} from '../../../application/use-cases/check-view-reservation/ports/in/get-reservation-detail.port.js';
import {
  LIST_RESERVATIONS,
  type ListReservations,
  type ReservationListResult,
} from '../../../application/use-cases/check-view-reservation/ports/in/list-reservations.port.js';
import { ClientHeader } from './request-headers.js';
import {
  type ReservationDetailBody,
  toReservationDetailBody,
} from './reservation-detail.dto.js';
import { readReservationListQuery } from './reservation-list-query.dto.js';

/** Las rutas de reservas de `check-view-reservation` (C1 y C3 y, en sus tareas, C2, C4 y C5). */
@Controller('reservations')
export class ReservationsController {
  constructor(
    @Inject(LIST_RESERVATIONS)
    private readonly listReservations: ListReservations,
    @Inject(GET_RESERVATION_DETAIL)
    private readonly getReservationDetail: GetReservationDetail,
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

  /**
   * C3, `GET /api/reservations/{reservationRef}` para la Recepcionista: el detalle completo (FR-006). El
   * formato de la referencia lo revisa el caso de uso antes de consultar (T017). Con `MODULE3` esta ruta
   * dará la consulta para liquidar (C4, T032); hasta entonces responde `INVALID_CLIENT`. La ruta fija
   * `day-summary` (C2, T012) se declara antes que esta.
   */
  @Get(':reservationRef')
  async detail(
    @ClientHeader(['RECEPTIONIST']) _client: string,
    @Param('reservationRef') reservationRef: string,
  ): Promise<ReservationDetailBody> {
    return toReservationDetailBody(
      await this.getReservationDetail.execute(reservationRef),
    );
  }
}
