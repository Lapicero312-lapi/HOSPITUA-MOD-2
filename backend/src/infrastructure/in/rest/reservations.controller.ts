import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
} from '@nestjs/swagger';
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
  GET_RESERVATION_FOR_BILLING,
  type GetReservationForBilling,
} from '../../../application/use-cases/check-view-reservation/ports/in/get-reservation-for-billing.port.js';
import { BusinessError } from '../../../domain/shared/business-error.js';
import { RESERVATION_NOT_FOUND } from '../../../domain/shared/error-codes.js';
import { ApiError } from '../../shared/api-error.js';
import {
  LIST_RESERVATIONS,
  type ListReservations,
  type ReservationListResult,
} from '../../../application/use-cases/check-view-reservation/ports/in/list-reservations.port.js';
import {
  CONFIRM_MODIFICATION,
  type ConfirmModification,
} from '../../../application/use-cases/update-reservation/ports/in/confirm-modification.port.js';
import {
  PREVIEW_MODIFICATION,
  type PreviewModification,
} from '../../../application/use-cases/update-reservation/ports/in/preview-modification.port.js';
import { ApiErrorBody } from '../../shared/api-error.js';
import { ClientHeader, UserHeader } from './request-headers.js';
import {
  CANCELLATION_ERROR_EXAMPLES,
  CANCELLATION_EXAMPLE,
  CANCELLATION_REQUEST_EXAMPLE,
  RESERVATION_REF_PATTERN,
  type ReservationCancellationBody,
  ReservationCancellationDto,
  ReservationCancellationRequestDto,
  toReservationCancellationBody,
} from './reservation-cancellation.dto.js';
import {
  type ReservationBillingBody,
  toReservationBillingBody,
} from './reservation-billing.dto.js';
import {
  type ReservationDetailBody,
  toReservationDetailBody,
} from './reservation-detail.dto.js';
import {
  type ModificationPreviewBody,
  toModificationPreviewBody,
} from './reservation-modification.dto.js';
import { readReservationListQuery } from './reservation-list-query.dto.js';
import {
  readStayRangeQuery,
  type StayRangeBody,
  toStayRangeBody,
} from './stay-range-query.dto.js';

/**
 * Las rutas de reservas, compartidas por sus casos de uso: `check-view-reservation` (C1 a C5) y la
 * cancelación de `cancel-reservation` (A).
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
    @Inject(GET_RESERVATION_FOR_BILLING)
    private readonly getReservationForBilling: GetReservationForBilling,
    @Inject(FIND_RESERVATIONS_BY_STAY_RANGE)
    private readonly findByStayRange: FindReservationsByStayRange,
    @Inject(PREVIEW_MODIFICATION)
    private readonly previewModification: PreviewModification,
    @Inject(CONFIRM_MODIFICATION)
    private readonly confirmModification: ConfirmModification,
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
   * orden y paginación. Los filtros se validan antes de consultar, en el orden del plan (T007). Con
   * `search`, primero el código y, si no coincide ninguna, el documento o el nombre (T015 y T020).
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
    const { search, page, ...filters } = readReservationListQuery(query);
    return this.listReservations.execute(filters, page, search);
  }

  /**
   * C3, `GET /api/reservations/{reservationRef}` para la Recepcionista: el detalle completo (FR-006). El
   * formato de la referencia lo revisa el caso de uso antes de consultar (T017). Con `MODULE3` es la
   * consulta para liquidar (C4, T032). La ruta fija
   * `day-summary` (C2, T012) se declara antes que esta.
   */
  @Get(':reservationRef')
  async detail(
    @ClientHeader(['RECEPTIONIST', 'MODULE3']) client: string,
    @Param('reservationRef') reservationRef: string,
  ): Promise<ReservationDetailBody | ReservationBillingBody> {
    if (client === 'MODULE3') {
      return this.billing(reservationRef);
    }
    return toReservationDetailBody(
      await this.getReservationDetail.execute(reservationRef),
    );
  }

  /**
   * C4, la misma ruta con `X-Client: MODULE3`: lo que el Módulo 3 necesita para liquidar (FR-022, T032). Una
   * reserva que no existe responde `404`, la única excepción del plan base ("Errores"), porque el Módulo 3
   * la espera así; los demás errores, `400`.
   */
  private async billing(
    reservationRef: string,
  ): Promise<ReservationBillingBody> {
    try {
      return toReservationBillingBody(
        await this.getReservationForBilling.execute(reservationRef),
      );
    } catch (error) {
      if (
        error instanceof BusinessError &&
        error.errorCode === RESERVATION_NOT_FOUND.code
      ) {
        throw new ApiError(error.errorCode, error.message, 404);
      }
      throw error;
    }
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
  @ApiOperation({
    summary:
      'La Recepcionista cancela una reserva directa en `ACTIVE` o `PENDING`: la reserva pasa a `CANCELLED`, se registra su `Cancellation` y, si estaba en la lista del día, se avisa al Módulo 1 (`REMOVED`). No se puede deshacer y no tiene efectos financieros. Una reserva de Booking no se cancela aquí: su cancelación llega por el feed de Channex (B, sin ruta).',
  })
  @ApiParam({
    name: 'reservationRef',
    description:
      'La referencia de la reserva: `RSV-` y 8 hexadecimales en mayúscula.',
    schema: { type: 'string', pattern: RESERVATION_REF_PATTERN },
    example: 'RSV-3F9A1C7B',
  })
  @ApiHeader({
    name: 'X-User',
    required: true,
    description:
      'La Recepcionista que cancela (máximo 100 caracteres): se guarda en `processed_by` y sale como `processedBy`.',
  })
  @ApiBody({
    type: ReservationCancellationRequestDto,
    examples: {
      PLAN: {
        summary: 'El ejemplo del contrato A del plan',
        value: CANCELLATION_REQUEST_EXAMPLE,
      },
    },
  })
  @ApiOkResponse({
    type: ReservationCancellationDto,
    description: 'La reserva cancelada y su `Cancellation`.',
    example: CANCELLATION_EXAMPLE,
  })
  @ApiBadRequestResponse({
    type: ApiErrorBody,
    description:
      'Falta `X-User` o no es válido, la referencia o el motivo no son válidos, la reserva no existe o es de Booking, falta la confirmación, otro cambio ganó o el estado no admite cancelación, o una excepción inesperada. Nada queda a medias.',
    examples: CANCELLATION_ERROR_EXAMPLES,
  })
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

  /**
   * B1 de `update-reservation`, `POST /api/reservations/{reservationRef}/modification-preview`: la vista
   * previa de la modificación de una reserva directa (D1 y regla 8). No guarda nada. Responde `200` con los
   * cambios, la disponibilidad verificada, las tarifas recotizadas y el total; los errores de la tabla de B
   * salen por el filtro global como `400`.
   */
  @Post(':reservationRef/modification-preview')
  @HttpCode(200)
  async modificationPreview(
    @Param('reservationRef') reservationRef: string,
    @Body() body: unknown,
  ): Promise<ModificationPreviewBody> {
    return toModificationPreviewBody(
      await this.previewModification.execute(reservationRef, body),
    );
  }

  /**
   * B2 de `update-reservation`, `PATCH /api/reservations/{reservationRef}`: la confirmación de la
   * modificación de una reserva directa (D2 y regla 9). Repite las validaciones de la vista previa, vuelve a
   * cotizar y compara con `expectedRates`, y guarda con el aviso a la lista del día. Responde `200` con el
   * detalle de la reserva (C3 de `check-view-reservation`) y su `updatedAt` nuevo; los errores de la tabla de
   * B salen por el filtro global como `400`.
   */
  @Patch(':reservationRef')
  async confirmModificationOf(
    @Param('reservationRef') reservationRef: string,
    @Body() body: unknown,
  ): Promise<ReservationDetailBody> {
    return toReservationDetailBody(
      await this.confirmModification.execute(reservationRef, body),
    );
  }
}
