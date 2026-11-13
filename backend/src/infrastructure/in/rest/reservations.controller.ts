import {
  applyDecorators,
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
  ApiExtraModels,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  getSchemaPath,
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
  ASSIGN_ROOM,
  type AssignRoom,
} from '../../../application/use-cases/update-reservation/ports/in/assign-room.port.js';
import {
  PREVIEW_MODIFICATION,
  type PreviewModification,
} from '../../../application/use-cases/update-reservation/ports/in/preview-modification.port.js';
import {
  RESERVATION_SOURCES,
  RESERVATION_STATUSES,
} from '../../../domain/shared/enums.js';
import type { Client } from '../../shared/clients.js';
import { ApiErrorBody } from '../../shared/api-error.js';
import {
  DAY_SUMMARY_ERROR_EXAMPLES,
  DAY_SUMMARY_EXAMPLE,
  DaySummaryDto,
} from './day-summary.dto.js';
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
  BILLING_DIRECT_EXAMPLE,
  BILLING_NOT_FOUND_EXAMPLE,
  BILLING_OTA_EXAMPLE,
  type ReservationBillingBody,
  ReservationBillingDto,
  toReservationBillingBody,
} from './reservation-billing.dto.js';
import {
  DETAIL_ERROR_EXAMPLES,
  RESERVATION_DETAIL_EXAMPLE,
  type ReservationDetailBody,
  ReservationDetailDto,
  toReservationDetailBody,
} from './reservation-detail.dto.js';
import {
  type ModificationPreviewBody,
  toModificationPreviewBody,
} from './reservation-modification.dto.js';
import { readReservationListQuery } from './reservation-list-query.dto.js';
import {
  LIST_ERROR_EXAMPLES,
  RESERVATION_LIST_EXAMPLE,
  ReservationListDto,
} from './reservation-list.dto.js';
import {
  readStayRangeQuery,
  STAY_RANGE_EXAMPLE,
  type StayRangeBody,
  StayRangeDto,
  toStayRangeBody,
} from './stay-range-query.dto.js';

/**
 * `X-Client` en OpenAPI: obligatoria, con los llamadores que admite la ruta (plan, "OpenAPI (T037) y
 * pruebas de contrato (T034)").
 */
const clientHeader = (clients: Client[]) => ({
  name: 'X-Client',
  required: true,
  schema: { type: 'string', enum: clients },
  description:
    'Quién llama (plan base, regla transversal 10). Sin ella, o con un llamador que la ruta no admite, `400` `INVALID_CLIENT`.',
});

/** Un parámetro opcional de `GET /api/reservations`, con el llamador que lo usa en la descripción. */
const listQuery = (
  name: string,
  description: string,
  schema: Record<string, unknown> = { type: 'string' },
) => ({ name, required: false, description, schema });

/**
 * Los parámetros de `GET /api/reservations`: los de C1 en su orden y `roomId` de C5. Ninguno es obligatorio
 * para los dos llamadores: las fechas lo son solo con `MODULE1`, y su descripción lo dice.
 */
const LIST_QUERY_PARAMETERS = [
  listQuery(
    'search',
    'Recepcionista. El código de la reserva o de la OTA, un documento o un nombre (máximo 40: letras, dígitos y guion). Primero se busca el código, que ignora los demás filtros.',
  ),
  listQuery('status', 'Recepcionista. Sin valor: todos los estados.', {
    type: 'string',
    enum: RESERVATION_STATUSES,
  }),
  listQuery('source', 'Recepcionista.', {
    type: 'string',
    enum: RESERVATION_SOURCES,
  }),
  listQuery('otaId', 'Recepcionista. Una agencia; solo con `source=OTA`.', {
    type: 'string',
    format: 'uuid',
  }),
  listQuery(
    'inConflict',
    'Recepcionista. Solo las reservas de Booking en conflicto.',
    { type: 'string', enum: ['true'] },
  ),
  listQuery(
    'dateFrom',
    'Los dos. Con la Recepcionista, las dos fechas o ninguna; con el Módulo 1, obligatoria. Cruce: `startDate ≤ dateTo` y `endDate > dateFrom`; máximo 366 días.',
    { type: 'string', format: 'date' },
  ),
  listQuery(
    'dateTo',
    'Los dos. Con la Recepcionista, las dos fechas o ninguna; con el Módulo 1, obligatoria.',
    { type: 'string', format: 'date' },
  ),
  listQuery('order', 'Recepcionista. Por `startDate`; por defecto `desc`.', {
    type: 'string',
    enum: ['asc', 'desc'],
  }),
  listQuery(
    'page',
    'Recepcionista. Por defecto 1; si supera las páginas, la última válida.',
    { type: 'integer', minimum: 1 },
  ),
  listQuery(
    'roomId',
    'Módulo 1. Solo las reservas de esa habitación, cada una con todas sus habitaciones.',
    { type: 'string', format: 'uuid' },
  ),
];

/** Los parámetros de `LIST_QUERY_PARAMETERS`, en ese orden (cada `@ApiQuery` suelto los dejaría al revés). */
const ApiListQueryParameters = () =>
  applyDecorators(...LIST_QUERY_PARAMETERS.map((query) => ApiQuery(query)));

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
    @Inject(ASSIGN_ROOM)
    private readonly assignRoom: AssignRoom,
  ) {}

  /**
   * C2, `GET /api/reservations/day-summary` para la Recepcionista: las llegadas y salidas esperadas del día
   * operativo. Es una ruta fija: debe quedar declarada antes que `/{reservationRef}` (C3, T016), para que
   * no se confunda con una referencia.
   */
  @Get('day-summary')
  @ApiOperation({
    summary:
      'C2. La Recepcionista ve las llegadas y las salidas esperadas del día operativo (FR-005a), solo con datos del Módulo 2: nunca la ocupación física.',
  })
  @ApiHeader(clientHeader(['RECEPTIONIST']))
  @ApiOkResponse({
    type: DaySummaryDto,
    description: 'Las dos cifras del día operativo.',
    example: DAY_SUMMARY_EXAMPLE,
  })
  @ApiBadRequestResponse({
    type: ApiErrorBody,
    description:
      'Sin `X-Client` o con otro llamador, o una excepción inesperada.',
    examples: DAY_SUMMARY_ERROR_EXAMPLES,
  })
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
  @ApiOperation({
    summary:
      'C1 y C5: la respuesta depende de `X-Client`. Con `RECEPTIONIST`, el listado con filtros, búsqueda, orden y páginas de 10 (C1). Con `MODULE1`, las reservas vigentes cuya estadía se cruza con el rango, sin paginar (C5).',
    description:
      'Con `MODULE1` solo se admiten `dateFrom`, `dateTo` (obligatorias) y `roomId`; cualquier otro parámetro responde `400` `UNSUPPORTED_PARAMETER`. La respuesta de cada uno no trae datos financieros.',
  })
  @ApiHeader(clientHeader(['RECEPTIONIST', 'MODULE1']))
  @ApiListQueryParameters()
  @ApiExtraModels(ReservationListDto, StayRangeDto)
  @ApiOkResponse({
    description:
      'Con `RECEPTIONIST`, `ReservationListDto` (C1); con `MODULE1`, `StayRangeDto` (C5).',
    schema: {
      oneOf: [
        { $ref: getSchemaPath(ReservationListDto) },
        { $ref: getSchemaPath(StayRangeDto) },
      ],
    },
    examples: {
      RECEPTIONIST: {
        summary: 'Recepcionista: el ejemplo de C1',
        value: RESERVATION_LIST_EXAMPLE,
      },
      MODULE1: {
        summary: 'Módulo 1: el ejemplo de C5',
        value: STAY_RANGE_EXAMPLE,
      },
    },
  })
  @ApiBadRequestResponse({
    type: ApiErrorBody,
    description:
      'Sin `X-Client` o con otro llamador, un filtro o un parámetro no válido (el primero que falla responde), una referencia `RSV-` sin coincidencia, o una excepción inesperada.',
    examples: LIST_ERROR_EXAMPLES,
  })
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
  @ApiOperation({
    summary:
      'C3 y C4: la respuesta depende de `X-Client`. Con `RECEPTIONIST`, el detalle completo de la reserva (C3, FR-006). Con `MODULE3`, lo que necesita para liquidar (C4, FR-022).',
    description:
      'Una reserva que no existe responde `400` a la Recepcionista y `404` al Módulo 3: es la única `404` del Módulo 2 (plan base, "Errores").',
  })
  @ApiParam({
    name: 'reservationRef',
    description:
      'La referencia de la reserva: `RSV-` y 8 hexadecimales en mayúscula.',
    schema: { type: 'string', pattern: RESERVATION_REF_PATTERN },
    example: 'RSV-3F9A1C7B',
  })
  @ApiHeader(clientHeader(['RECEPTIONIST', 'MODULE3']))
  @ApiExtraModels(ReservationDetailDto, ReservationBillingDto)
  @ApiOkResponse({
    description:
      'Con `RECEPTIONIST`, `ReservationDetailDto` (C3); con `MODULE3`, `ReservationBillingDto` (C4).',
    schema: {
      oneOf: [
        { $ref: getSchemaPath(ReservationDetailDto) },
        { $ref: getSchemaPath(ReservationBillingDto) },
      ],
    },
    examples: {
      RECEPTIONIST: {
        summary: 'Recepcionista: el ejemplo de C3',
        value: RESERVATION_DETAIL_EXAMPLE,
      },
      MODULE3_DIRECT: {
        summary: 'Módulo 3: el ejemplo de C4 de una reserva directa',
        value: BILLING_DIRECT_EXAMPLE,
      },
      MODULE3_OTA: {
        summary: 'Módulo 3: el ejemplo de C4 de una reserva de Booking',
        value: BILLING_OTA_EXAMPLE,
      },
    },
  })
  @ApiBadRequestResponse({
    type: ApiErrorBody,
    description:
      'Sin `X-Client` o con otro llamador, una referencia con otro formato, una reserva que no existe (Recepcionista) o una excepción inesperada.',
    examples: DETAIL_ERROR_EXAMPLES,
  })
  @ApiNotFoundResponse({
    type: ApiErrorBody,
    description: 'Solo con `MODULE3`: la reserva no existe.',
    examples: { RESERVATION_NOT_FOUND: BILLING_NOT_FOUND_EXAMPLE },
  })
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
   * B3 de `update-reservation`, `PATCH /api/reservations/{reservationRef}/room-assignment`: la Recepcionista
   * asigna habitación a las sin asignar de una reserva de Booking en conflicto (FR-025, punto 16). `X-User`
   * es obligatorio (`USER_REQUIRED` o `INVALID_USER`) y no se guarda. Responde `200` con el detalle de C3;
   * los errores salen por el filtro global como `400`.
   */
  @Patch(':reservationRef/room-assignment')
  async assignRoomOf(
    @Param('reservationRef') reservationRef: string,
    @UserHeader() _user: string,
    @Body() body: unknown,
  ): Promise<ReservationDetailBody> {
    return toReservationDetailBody(
      await this.assignRoom.execute(reservationRef, body),
    );
  }
}
