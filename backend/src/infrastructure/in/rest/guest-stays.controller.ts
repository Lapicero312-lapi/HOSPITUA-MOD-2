import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiExcludeEndpoint,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import {
  readGuestStayFilters,
  readGuestStayKey,
} from '../../../application/use-cases/process-guest-data/guest-stay-filters.validator.js';
import {
  GET_GUEST_STAY_DETAIL,
  type GetGuestStayDetail,
  type GuestStayDetail,
} from '../../../application/use-cases/process-guest-data/ports/in/get-guest-stay-detail.port.js';
import {
  LIST_GUEST_STAYS,
  type GuestStayPage,
  type ListGuestStays,
} from '../../../application/use-cases/process-guest-data/ports/in/list-guest-stays.port.js';
import { ApiErrorBody } from '../../shared/api-error.js';
import {
  GUEST_STAY_DETAIL_ERROR_EXAMPLES,
  GUEST_STAY_DETAIL_EXAMPLE,
  GUEST_STAYS_ERROR_EXAMPLES,
  GUEST_STAYS_EXAMPLE,
  GuestStayDetailDto,
  GuestStayPageDto,
} from './guest-stays.dto.js';

/**
 * La vista de huéspedes alojados de la Recepcionista (plan de `process-guest-data`, C1 y C2). Solo
 * lectura. Sin prefijo propio: el detalle cuelga de la reserva (`/api/reservations/…/guests/…`).
 */
@Controller()
export class GuestStaysController {
  constructor(
    @Inject(LIST_GUEST_STAYS)
    private readonly listGuestStays: ListGuestStays,
    @Inject(GET_GUEST_STAY_DETAIL)
    private readonly getGuestStayDetail: GetGuestStayDetail,
  ) {}

  /**
   * C1, `GET /api/guest-stays`: revisa los filtros antes de consultar (D3) y devuelve la página. Con un
   * filtro inválido, el filtro global responde 400 con el código del validador.
   */
  @Get('guest-stays')
  @ApiOperation({
    summary:
      'Los huéspedes alojados: una fila por huésped y reserva, con su entrada y su salida, de la entrada más reciente a la más antigua, en páginas de 10. Solo aparecen los huéspedes con al menos un movimiento (FR-016). Solo lectura.',
  })
  // Nest aplica los decoradores de abajo hacia arriba: así OpenAPI los lista en el orden de la tabla de C1.
  @ApiQuery({
    name: 'page',
    required: false,
    schema: { type: 'integer', minimum: 1, default: 1 },
    description: 'Por defecto `1`; tamaño fijo de 10.',
  })
  @ApiQuery({
    name: 'search',
    required: false,
    schema: { type: 'string' },
    description:
      'Con al menos un dígito: `documentNumber` exacto; sin dígitos: nombre o apellido parcial, mínimo 3 caracteres, sin distinguir mayúsculas ni tildes.',
  })
  @ApiQuery({
    name: 'dateTo',
    required: false,
    schema: { type: 'string', format: 'date' },
    description:
      'Con `dateFrom`: las dos o ninguna. Rango inclusivo, máximo un año (366 días).',
  })
  @ApiQuery({
    name: 'dateFrom',
    required: false,
    schema: { type: 'string', format: 'date' },
    description:
      'Con `dateTo`: las dos o ninguna. Rango inclusivo, máximo un año (366 días).',
  })
  @ApiQuery({
    name: 'presence',
    required: false,
    schema: {
      type: 'string',
      enum: ['ALL', 'IN_HOTEL', 'CHECKED_OUT'],
      default: 'ALL',
    },
    description:
      '`IN_HOTEL`: con entrada y sin salida; `CHECKED_OUT`: con salida.',
  })
  @ApiQuery({
    name: 'nationality',
    required: false,
    schema: {
      type: 'string',
      enum: ['ALL', 'FOREIGN', 'COLOMBIAN'],
      default: 'ALL',
    },
    description: 'Por defecto `ALL`.',
  })
  @ApiOkResponse({
    type: GuestStayPageDto,
    description:
      'La página pedida. Sin resultados: `items: []`, `totalItems: 0` y el mensaje "No hay huéspedes que coincidan con los filtros.".',
    example: GUEST_STAYS_EXAMPLE,
  })
  @ApiBadRequestResponse({
    type: ApiErrorBody,
    description:
      'Un filtro inválido, revisado antes de consultar (los códigos de la tabla de C1), o una excepción inesperada (`REQUEST_NOT_PROCESSED`).',
    examples: GUEST_STAYS_ERROR_EXAMPLES,
  })
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

  /**
   * C2 con el `documentNumber` vacío (`…/guests` o `…/guests/`): sin esta ruta, el filtro global la
   * respondería como una ruta que no existe (`400 REQUEST_NOT_PROCESSED`). Pasa por la misma revisión que
   * `detail`: `INVALID_RESERVATION_CODE` o `INVALID_DOCUMENT_NUMBER`.
   */
  @Get('reservations/:reservationRef/guests')
  @ApiExcludeEndpoint()
  async detailWithoutDocument(
    @Param('reservationRef') reservationRef: string,
  ): Promise<GuestStayDetail> {
    return this.detail(reservationRef, '');
  }

  /**
   * C2, `GET /api/reservations/{reservationRef}/guests/{documentNumber}`: revisa los dos antes de
   * consultar. Con un formato inválido o un huésped que no está, el filtro global responde 400.
   */
  @Get('reservations/:reservationRef/guests/:documentNumber')
  @ApiOperation({
    summary:
      'El detalle de un huésped en una reserva: todos sus datos, el enlace a la reserva y sus movimientos de entrada y salida con su fecha. Solo lectura.',
  })
  @ApiParam({
    name: 'reservationRef',
    schema: {
      type: 'string',
      pattern: '^RSV-[0-9A-F]{8}$',
      example: 'RSV-3F9A1C7B',
    },
  })
  @ApiParam({
    name: 'documentNumber',
    schema: { type: 'string', example: 'X99' },
    description: 'El documento del huésped.',
  })
  @ApiOkResponse({
    type: GuestStayDetailDto,
    description:
      'El huésped. Lo vacío viaja `null`; la pantalla muestra una raya "—".',
    example: GUEST_STAY_DETAIL_EXAMPLE,
  })
  @ApiBadRequestResponse({
    type: ApiErrorBody,
    description:
      'El huésped o la reserva no existen o el huésped no tiene movimientos (`GUEST_NOT_FOUND`), la referencia o el documento no son válidos (`INVALID_RESERVATION_CODE`, `INVALID_DOCUMENT_NUMBER`), o una excepción inesperada (`REQUEST_NOT_PROCESSED`).',
    examples: GUEST_STAY_DETAIL_ERROR_EXAMPLES,
  })
  async detail(
    @Param('reservationRef') reservationRef: string,
    @Param('documentNumber') documentNumber: string,
  ): Promise<GuestStayDetail> {
    const key = readGuestStayKey(reservationRef, documentNumber);
    return this.getGuestStayDetail.execute(
      key.reservationRef,
      key.documentNumber,
    );
  }
}
