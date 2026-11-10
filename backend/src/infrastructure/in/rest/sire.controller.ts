import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Res,
  StreamableFile,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  SIRE_CONFIG,
  type SireConfig,
} from '../../../application/ports/out/sire-config.js';
import {
  EXPORT_SIRE_FILE,
  type ExportSireFile,
} from '../../../application/use-cases/export-sire-file/ports/in/export-sire-file.port.js';
import {
  LIST_SIRE_MOVEMENTS,
  type ListSireMovements,
  type SireMovementPage,
} from '../../../application/use-cases/export-sire-file/ports/in/list-sire-movements.port.js';
import {
  PREVIEW_SIRE_MOVEMENT,
  type PreviewSireMovement,
  type SireMovementPreview,
} from '../../../application/use-cases/export-sire-file/ports/in/preview-sire-movement.port.js';
import { readSireExportRequest } from '../../../application/use-cases/export-sire-file/sire-export-request.validator.js';
import { readSireMovementsQuery } from '../../../application/use-cases/export-sire-file/sire-movements-query.validator.js';
import { UserHeader } from './request-headers.js';
import { SireRateLimiter } from './sire-rate-limiter.js';

/** El `charset` de `Content-Type` para cada `SIRE_FILE_ENCODING` (nombres de la IANA). */
const CHARSETS = { 'utf-8': 'utf-8', latin1: 'ISO-8859-1' } as const;

/**
 * "Exportar archivo SIRE" de la Recepcionista (plan de `export-sire-file`, contratos A, B y C). Los errores salen
 * por el filtro global como `400` con su `errorCode`, y el límite de solicitudes como `429`.
 */
@Controller('sire')
export class SireController {
  constructor(
    @Inject(EXPORT_SIRE_FILE)
    private readonly exportSireFile: ExportSireFile,
    @Inject(LIST_SIRE_MOVEMENTS)
    private readonly listSireMovements: ListSireMovements,
    @Inject(PREVIEW_SIRE_MOVEMENT)
    private readonly previewSireMovement: PreviewSireMovement,
    @Inject(SIRE_CONFIG)
    private readonly config: SireConfig,
  ) {}

  /**
   * A, `POST /api/sire/exports`: es `POST` porque registra una `SireExport` (D9). En el orden de D1:
   * - el limitador revisa `X-User` y los límites (`USER_REQUIRED`, `INVALID_USER` o `429`);
   * - se revisa el cuerpo sin ejecutar ninguna consulta;
   * - la exportación arma el archivo y lo registra.
   *
   * Responde `200` con **únicamente el archivo** (FR-008), en la codificación configurada, con `Export-Id`
   * y `Content-Disposition`, y las expone al navegador.
   */
  @Post('exports')
  @HttpCode(200)
  @UseInterceptors(SireRateLimiter)
  async export(
    @Body() body: unknown,
    @UserHeader() processedBy: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const request = readSireExportRequest(body, this.config.maxPeriodDays);
    const file = await this.exportSireFile.execute(request, processedBy);
    const { encoding } = this.config.format;
    response.setHeader('Export-Id', file.exportId);
    response.setHeader(
      'Access-Control-Expose-Headers',
      'Export-Id, Content-Disposition',
    );
    return new StreamableFile(Buffer.from(file.content, encoding), {
      type: `text/plain; charset=${CHARSETS[encoding]}`,
      disposition: `attachment; filename="${file.fileName}"`,
    });
  }

  /**
   * B, `GET /api/sire/movements`: los movimientos de extranjeros del periodo, de 50 en 50 (D3). Revisa el
   * periodo y la página sin ejecutar ninguna consulta. Solo lee: no registra nada ni pasa por el limitador,
   * que es solo de la exportación (punto 13).
   */
  @Get('movements')
  list(@Query() query: unknown): Promise<SireMovementPage> {
    return this.listSireMovements.execute(
      readSireMovementsQuery(query, this.config.maxPeriodDays),
    );
  }

  /**
   * C, `GET /api/sire/movements/{movementId}/preview`: la línea de un movimiento tal como saldría en el
   * archivo. Solo lee: no crea una `SireExport` ni pasa por el limitador, que es solo de la exportación
   * (punto 13).
   */
  @Get('movements/:movementId/preview')
  preview(
    @Param('movementId') movementId: string,
  ): Promise<SireMovementPreview> {
    return this.previewSireMovement.execute(movementId);
  }
}
