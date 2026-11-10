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
  type CancelReservation,
} from '../../../application/use-cases/cancel-reservation/ports/in/cancel-reservation.port.js';
import {
  FIND_RESERVATIONS_BY_STAY_RANGE,
  type FindReservationsByStayRange,
} from '../../../application/use-cases/check-view-reservation/ports/in/find-reservations-by-stay-range.port.js';
import {
  GET_DAY_SUMMARY,
  type DaySummary,
  type GetDaySummary,
} from '../../../application/use-cases/check-view-reservation/ports/in/get-day-summary.port.js';
import {
  GET_RESERVATION_DETAIL,
  type GetReservationDetail,
} from '../../../application/use-cases/check-view-reservation/ports/in/get-reservation-detail.port.js';
import {
  LIST_RESERVATIONS,
  type ListReservations,
  type ReservationListResult,
} from '../../../application/use-cases/check-view-reservation/ports/in/list-reservations.port.js';
import { ClientHeader, UserHeader } from './request-headers.js';
import {
  type ReservationCancellationBody,
  toReservationCancellationBody,
} from './reservation-cancellation.dto.js';
import {
  type ReservationDetailBody,
  toReservationDetailBody,
} from './reservation-detail.dto.js';
import { readReservationListQuery } from './reservation-list-query.dto.js';
import {
  readStayRangeQuery,
  type StayRangeBody,
  toStayRangeBody,
} from './stay-range-query.dto.js';

/**
 * Las rutas de reservas, compartidas por sus casos de uso: `check-view-reservation` (C1, C2, C3, C5 y, en
 * su tarea, C4) y la cancelación de `cancel-reservation` (A).
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
    @Inject(GET_RESERVATION_DETAIL)
    private readonly getReservationDetail: GetReservationDetail,
    @Inject(FIND_RESERVATIONS_BY_STAY_RANGE)
    private readonly findByStayRange: FindReservationsByStayRange,
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
   * búsqueda (`search`) se valida, pero todavía no filtra: la agregan T015 y T020.
   *
   * C5, la misma ruta con `X-Client: MODULE1`: las reservas vigentes cuya estadía se cruza con un rango de
   * fechas y, si viene `roomId`, las de esa habitación (FR-023, T033). Sus parámetros los revisa
   * `readStayRangeQuery`, que rechaza cualquier otro con `UNSUPPORTED_PARAMETER`.
   */
  @Get()
  async list(
    @ClientHeader(['RECEPTIONIST', 'MODULE1']) client: string,
    @Query() query: Record<string, unknown>,
  ): Promise<ReservationListResult | StayRangeBody> {
    if (client === 'MODULE1') {
      return toStayRangeBody(
        await this.findByStayRange.execute(readStayRangeQuery(query)),
      );
    }
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

  /**
   * A de `cancel-reservation`, `POST /api/reservations/{reservationRef}/cancellation`: la Recepcionista
   * cancela una reserva directa (D1). `X-User` es quien la hace (`USER_REQUIRED` si falta). Las reglas, en
   * el orden de la regla 3, las aplica `CancelReservation` en su propia transacción. Responde `200` con la
   * cancelación; los errores salen por el filtro global como `400`. La referencia es opcional en la ruta para
   * que una vacía (`…//cancellation`) también llegue a esa revisión y responda `RESERVATION_REF_REQUIRED`.
   */
  @Post('{:reservationRef}/cancellation')
  @HttpCode(200)
  async cancel(
    @Param('reservationRef') reservationRef = '',
    @UserHeader() processedBy: string,
    @Body() body: unknown,
  ): Promise<ReservationCancellationBody> {
    const { acknowledged, expectedUpdatedAt, reason } =
      readReceptionCancellationBody(reservationRef, body);
    const result = await this.cancelReservation.execute({
      reservationRef,
      channel: 'RECEPTION',
      processedBy,
      reason,
      acknowledged,
      expectedUpdatedAt,
    });
    return toReservationCancellationBody(result);
  }
}
