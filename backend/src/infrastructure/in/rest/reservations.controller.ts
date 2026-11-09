import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { readReceptionCancellationBody } from '../../../application/use-cases/cancel-reservation/cancel-request.validator.js';
import {
  CANCEL_RESERVATION,
  type CancellationResult,
  type CancelReservation,
} from '../../../application/use-cases/cancel-reservation/ports/in/cancel-reservation.port.js';
import {
  GET_DAY_SUMMARY,
  type DaySummary,
  type GetDaySummary,
} from '../../../application/use-cases/check-view-reservation/ports/in/get-day-summary.port.js';
import {
  LIST_RESERVATIONS,
  type ListReservations,
  type ReservationListResult,
} from '../../../application/use-cases/check-view-reservation/ports/in/list-reservations.port.js';
import { ClientHeader, UserHeader } from './request-headers.js';
import { readReservationListQuery } from './reservation-list-query.dto.js';

/**
 * Las rutas de reservas, compartidas por sus casos de uso: `check-view-reservation` (C1, C2 y, en sus
 * tareas, C3 a C5) y la cancelación de `cancel-reservation` (A).
 */
@Controller('reservations')
export class ReservationsController {
  constructor(
    @Inject(LIST_RESERVATIONS)
    private readonly listReservations: ListReservations,
    @Inject(GET_DAY_SUMMARY)
    private readonly getDaySummary: GetDaySummary,
    @Inject(CANCEL_RESERVATION)
    private readonly cancelReservation: CancelReservation,
  ) {}

  /**
   * C2, `GET /api/reservations/day-summary` para la Recepcionista: las llegadas y salidas esperadas del día
   * operativo. Es una ruta fija: debe quedar declarada antes que `/{reservationRef}` (C3, T016), para que
   * no se confunda con una referencia.
   */
  @Get('day-summary')
  daySummary(
    @ClientHeader(['RECEPTIONIST']) _client: string,
  ): Promise<DaySummary> {
    return this.getDaySummary.execute();
  }

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
   * A de `cancel-reservation`, `POST /api/reservations/{reservationRef}/cancellation`: la Recepcionista
   * cancela una reserva directa (D1). `X-User` es quien la hace (`USER_REQUIRED` si falta). Las reglas, en
   * el orden de la regla 3, las aplica `CancelReservation` en su propia transacción. Responde `200` con la
   * cancelación; los errores salen por el filtro global como `400`.
   */
  @Post(':reservationRef/cancellation')
  @HttpCode(200)
  async cancel(
    @Param('reservationRef') reservationRef: string,
    @UserHeader() processedBy: string,
    @Body() body: unknown,
  ): Promise<CancellationResult> {
    const { acknowledged, expectedUpdatedAt, reason } =
      readReceptionCancellationBody(reservationRef, body);
    return this.cancelReservation.execute({
      reservationRef,
      channel: 'RECEPTION',
      processedBy,
      reason,
      acknowledged,
      expectedUpdatedAt,
    });
  }
}
