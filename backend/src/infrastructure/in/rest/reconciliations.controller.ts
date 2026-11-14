import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
} from '@nestjs/swagger';
import {
  RECONCILE_COMMISSIONS,
  RECONCILIATION_MAX_ITEMS,
  type ReconcileCommissions,
  type ReconciliationOutcome,
} from '../../../application/use-cases/register-ota-information-commission/ports/in/reconcile-commissions.port.js';
import { readReconciliationRequest } from '../../../application/use-cases/register-ota-information-commission/reconciliation-request.validator.js';
import { ApiErrorBody } from '../../shared/api-error.js';
import {
  RECONCILIATION_ERROR_EXAMPLES,
  RECONCILIATION_OUTCOME_EXAMPLE,
  RECONCILIATION_REQUEST_EXAMPLE,
  ReconciliationOutcomeDto,
  ReconciliationRequestDto,
} from './ota-commissions.openapi.js';

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
  @ApiOperation({
    summary:
      'El Módulo 3 marca comisiones como `RECONCILED` o `PAID`. Cada ítem se procesa por separado y en su transacción: el Módulo 2 confirma que los montos coinciden con los guardados antes de cambiar el estado.',
  })
  @ApiBody({
    type: ReconciliationRequestDto,
    examples: {
      PLAN: {
        summary: 'El ejemplo de A2 del plan',
        value: RECONCILIATION_REQUEST_EXAMPLE,
      },
    },
  })
  @ApiOkResponse({
    type: ReconciliationOutcomeDto,
    description:
      'El resultado de cada ítem (`APPLIED`, `ALREADY_APPLIED` o `REJECTED` con su motivo) y el resumen.',
    example: RECONCILIATION_OUTCOME_EXAMPLE,
  })
  @ApiBadRequestResponse({
    type: ApiErrorBody,
    description:
      'Un cuerpo inválido, sin procesar ningún ítem, o una excepción inesperada.',
    examples: RECONCILIATION_ERROR_EXAMPLES,
  })
  @HttpCode(HttpStatus.OK)
  async execute(@Body() body: unknown): Promise<ReconciliationOutcome> {
    const request = readReconciliationRequest(body, this.maxItems);
    return this.reconcile.execute(request.action, request.items);
  }
}
