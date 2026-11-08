import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Post,
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
import { readSireExportRequest } from '../../../application/use-cases/export-sire-file/sire-export-request.validator.js';
import { UserHeader } from './request-headers.js';
import { SireRateLimiter } from './sire-rate-limiter.js';

/** El `charset` de `Content-Type` para cada `SIRE_FILE_ENCODING` (nombres de la IANA). */
const CHARSETS = { 'utf-8': 'utf-8', latin1: 'ISO-8859-1' } as const;

/**
 * "Exportar archivo SIRE" de la Recepcionista (plan de `export-sire-file`, contrato A). Los errores salen
 * por el filtro global como `400` con su `errorCode`, y el límite de solicitudes como `429`.
 */
@Controller('sire')
export class SireController {
  constructor(
    @Inject(EXPORT_SIRE_FILE)
    private readonly exportSireFile: ExportSireFile,
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
}
