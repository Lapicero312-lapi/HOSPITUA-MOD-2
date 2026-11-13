import { Controller, Get, Inject, Query } from '@nestjs/common';
import {
  LIST_OTA_COMMISSIONS,
  type ListOtaCommissions,
} from '../../../application/use-cases/register-ota-information-commission/ports/in/list-ota-commissions.port.js';
import {
  type OtaCommissionPageBody,
  readOtaCommissionQuery,
  toOtaCommissionPageBody,
} from './ota-commission-query.dto.js';

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
   * A1, `GET /api/ota-commissions`: las comisiones de las reservas OTA cuya `endDate` cae en el rango, de a
   * 100 (punto C1, T011). Los parámetros se revisan antes de consultar; sus errores salen por el filtro
   * global como `400`.
   */
  @Get()
  async list(
    @Query() query: Record<string, unknown>,
  ): Promise<OtaCommissionPageBody> {
    const { filters, page } = readOtaCommissionQuery(query);
    return toOtaCommissionPageBody(
      await this.listOtaCommissions.execute(filters, page),
    );
  }
}
