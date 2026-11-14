import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
} from '@nestjs/common';
import {
  RECONCILE_COMMISSIONS,
  RECONCILIATION_MAX_ITEMS,
  type ReconcileCommissions,
  type ReconciliationOutcome,
} from '../../../application/use-cases/register-ota-information-commission/ports/in/reconcile-commissions.port.js';
import { readReconciliationRequest } from '../../../application/use-cases/register-ota-information-commission/reconciliation-request.validator.js';

/**
 * La conciliación de comisiones (plan de `register-ota-information-commission`, A2), que usa el Módulo 3.
 * Sin `X-Client` ni `X-User`: la ruta tiene un solo llamador y la auditoría guarda `MODULE3`. El resultado de
 * cada ítem, rechazado o no, va en la `200`: solo una solicitud mal formada es un error (400, sin procesar
 * ningún ítem).
 */
@Controller('ota-commissions/reconciliations')
export class ReconciliationsController {
  constructor(
    @Inject(RECONCILE_COMMISSIONS)
    private readonly reconcile: ReconcileCommissions,
    @Inject(RECONCILIATION_MAX_ITEMS)
    private readonly maxItems: number,
  ) {}

  /** A2, `POST /api/ota-commissions/reconciliations`. */
  @Post()
  @HttpCode(HttpStatus.OK)
  async execute(@Body() body: unknown): Promise<ReconciliationOutcome> {
    const request = readReconciliationRequest(body, this.maxItems);
    return this.reconcile.execute(request.action, request.items);
  }
}
