import { Controller, Get, Inject, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
} from '@nestjs/swagger';
import {
  LIST_OTA_COMMISSIONS,
  type ListOtaCommissions,
} from '../../../application/use-cases/register-ota-information-commission/ports/in/list-ota-commissions.port.js';
import {
  type OtaCommissionPageBody,
  readOtaCommissionQuery,
  toOtaCommissionPageBody,
} from './ota-commission-query.dto.js';
import {
  OTA_COMMISSION_ERROR_EXAMPLES,
  OTA_COMMISSION_PAGE_EXAMPLE,
  OtaCommissionPageDto,
} from './ota-commissions.openapi.js';
import { ApiErrorBody } from '../../shared/api-error.js';
import { RequiresInternalKey } from './internal-key.guard.js';

/**
 * Las comisiones de las reservas OTA, para el Módulo 3 (plan de `register-ota-information-commission`, A1 y
 * A2). Cada ruta la usa un solo llamador, así que no necesita `X-Client` (plan, A).
 */
@Controller('ota-commissions')
export class OtaCommissionsController {
  constructor(
    @Inject(LIST_OTA_COMMISSIONS)
    private readonly listOtaCommissions: ListOtaCommissions,
  ) {}

  /**
   * A1, `GET /api/ota-commissions`: las comisiones de las reservas OTA cuya `endDate` cae en el rango, o la
   * de una sola reserva por su `reservationRef` (T022), de a 100 (punto C1, T011). Los parámetros se revisan antes de consultar; sus errores salen por el filtro
   * global como `400`.
   */
  @Get()
  @RequiresInternalKey()
  @ApiOperation({
    summary:
      'Las comisiones de las reservas OTA cuya `endDate` cae en el periodo, o de una sola por su `reservationRef`, de a 100, para el Módulo 3. Solo reservas de canal OTA; sin resultados no es un error.',
  })
  // Nest aplica los decoradores de abajo hacia arriba: así OpenAPI los lista en el orden de la tabla de A1.
  @ApiQuery({
    name: 'page',
    required: false,
    schema: { type: 'integer', minimum: 1, default: 1 },
    description: 'Por defecto `1`; tamaño fijo de 100.',
  })
  @ApiQuery({
    name: 'otaId',
    required: false,
    schema: { type: 'string', format: 'uuid' },
    description: 'Una agencia.',
  })
  @ApiQuery({
    name: 'reservationStatus',
    required: false,
    schema: {
      type: 'string',
      enum: [
        'PENDING',
        'ACTIVE',
        'IN_PROGRESS',
        'COMPLETED',
        'CANCELLED',
        'NO_SHOW',
      ],
    },
  })
  @ApiQuery({
    name: 'commissionStatus',
    required: false,
    schema: { type: 'string', enum: ['CALCULATED', 'RECONCILED', 'PAID'] },
    description: 'Sin valor: todos.',
  })
  @ApiQuery({
    name: 'dateTo',
    required: false,
    schema: { type: 'string', format: 'date' },
  })
  @ApiQuery({
    name: 'dateFrom',
    required: false,
    schema: { type: 'string', format: 'date' },
    description:
      'Rango inclusivo sobre la `endDate` de la reserva, con `dateTo`; máximo 366 días. Obligatorias las dos, salvo que venga `reservationRef` (entonces, las dos o ninguna).',
  })
  @ApiQuery({
    name: 'reservationRef',
    required: false,
    schema: { type: 'string', pattern: '^RSV-[0-9A-F]{8}$' },
    description:
      'Solo esa reserva; con ella, las fechas son opcionales. Una que no existe o es directa da `items: []`.',
  })
  @ApiOkResponse({
    type: OtaCommissionPageDto,
    description:
      'La página pedida, con los importes como texto y el porcentaje como número JSON.',
    example: OTA_COMMISSION_PAGE_EXAMPLE,
  })
  @ApiBadRequestResponse({
    type: ApiErrorBody,
    description:
      'Un parámetro inválido, revisado antes de consultar, o una excepción inesperada.',
    examples: OTA_COMMISSION_ERROR_EXAMPLES,
  })
  async list(
    @Query() query: Record<string, unknown>,
  ): Promise<OtaCommissionPageBody> {
    const { filters, page } = readOtaCommissionQuery(query);
    return toOtaCommissionPageBody(
      await this.listOtaCommissions.execute(filters, page),
    );
  }
}
