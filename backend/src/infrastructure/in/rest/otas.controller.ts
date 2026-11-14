import { Controller, Get, Inject, Param } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
} from '@nestjs/swagger';
import { colombiaTime } from '../../../application/use-cases/check-view-reservation/message-time.js';
import {
  GET_OTA,
  type GetOta,
} from '../../../application/use-cases/register-ota-information-commission/ports/in/get-ota.port.js';
import {
  LIST_OTAS,
  type ListOtas,
  type OtaOverview,
} from '../../../application/use-cases/register-ota-information-commission/ports/in/list-otas.port.js';
import { ApiErrorBody } from '../../shared/api-error.js';
import {
  OTA_ERROR_EXAMPLES,
  OTA_EXAMPLE,
  OtaDto,
  OtaListDto,
} from './ota-commissions.openapi.js';

/** Una agencia en A3. */
type OtaBody = {
  id: string;
  name: string;
  /** Un número, como en el ejemplo de A3; `null` mientras la agencia no tenga su primera reserva. */
  commissionPercentage: number | null;
  connectionStatus: OtaOverview['connectionStatus'];
  /** En hora de Colombia, con segundos (`2026-03-02T09:14:00-05:00`). */
  linkedAt: string;
  lastSyncAt: string;
  activeReservations: number;
};

/**
 * La consulta de agencias (plan de `register-ota-information-commission`, A3), de solo lectura. La usan la
 * Recepcionista y el Módulo 3, con la misma respuesta y sin `X-Client`.
 */
@Controller('otas')
export class OtasController {
  constructor(
    @Inject(LIST_OTAS)
    private readonly listOtas: ListOtas,
    @Inject(GET_OTA)
    private readonly getOta: GetOta,
  ) {}

  /** A3, `GET /api/otas`: todas las agencias, ordenadas por `name`, y cuántas son. */
  @Get()
  @ApiOperation({
    summary:
      'Las agencias, ordenadas por nombre, con su conexión y sus reservas vigentes. Solo lectura; una desconectada sigue apareciendo.',
  })
  @ApiOkResponse({
    type: OtaListDto,
    example: { items: [OTA_EXAMPLE], total: 1 },
  })
  async list(): Promise<{ items: OtaBody[]; total: number }> {
    const items = (await this.listOtas.execute()).map(toBody);
    return { items, total: items.length };
  }

  /**
   * A3, `GET /api/otas/{otaId}`: una agencia, con los mismos campos. Si no existe, el filtro global responde
   * 400 `OTA_NOT_FOUND`.
   */
  @Get(':otaId')
  @ApiOperation({
    summary: 'Una agencia, con los mismos campos que en la lista.',
  })
  @ApiOkResponse({ type: OtaDto, example: OTA_EXAMPLE })
  @ApiBadRequestResponse({
    type: ApiErrorBody,
    description: 'La agencia no existe.',
    examples: OTA_ERROR_EXAMPLES,
  })
  async get(@Param('otaId') otaId: string): Promise<OtaBody> {
    return toBody(await this.getOta.execute(otaId));
  }
}

function toBody(ota: OtaOverview): OtaBody {
  return {
    id: ota.id,
    name: ota.name,
    commissionPercentage:
      ota.commissionPercentage === null
        ? null
        : Number(ota.commissionPercentage),
    connectionStatus: ota.connectionStatus,
    linkedAt: colombiaTime(ota.linkedAt),
    lastSyncAt: colombiaTime(ota.lastSyncAt),
    activeReservations: ota.activeReservations,
  };
}
