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
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
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
import { ApiErrorBody } from '../../shared/api-error.js';
import { UserHeader } from './request-headers.js';
import {
  SIRE_EXPORT_ERROR_EXAMPLES,
  SIRE_EXPORT_REQUEST_EXAMPLES,
  SIRE_FILE_EXAMPLE,
  SIRE_MOVEMENTS_ERROR_EXAMPLES,
  SIRE_MOVEMENTS_EXAMPLES,
  SIRE_PREVIEW_ERROR_EXAMPLES,
  SIRE_PREVIEW_EXAMPLE,
  SIRE_TOO_MANY_REQUESTS_EXAMPLE,
  SireExportRequestDto,
  SireMovementPageDto,
  SireMovementPreviewDto,
} from './sire.dto.js';
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
  @ApiOperation({
    summary:
      'Genera el archivo SIRE de un periodo o de un solo movimiento, con los movimientos de los huéspedes extranjeros, y registra la descarga como una `SireExport`. Responde únicamente el archivo (FR-008). Es `POST` porque registra (D9).',
  })
  @ApiHeader({
    name: 'X-User',
    required: true,
    description:
      'La Recepcionista que exporta (máximo 100 caracteres): se guarda en `processed_by` y el límite de solicitudes se cuenta por él.',
  })
  @ApiBody({
    type: SireExportRequestDto,
    examples: SIRE_EXPORT_REQUEST_EXAMPLES,
  })
  @ApiOkResponse({
    description:
      'Únicamente el archivo: una línea por movimiento, con los 12 campos en orden. El separador, el formato de fecha, el fin de línea y la codificación salen de la configuración `SIRE_*`.',
    headers: {
      'Export-Id': {
        description: 'El `id` de la `SireExport` registrada.',
        schema: { type: 'string', format: 'uuid' },
      },
      'Content-Disposition': {
        description: '`attachment; filename="SIRE_<Export-Id>.txt"`.',
        schema: { type: 'string' },
      },
      'Access-Control-Expose-Headers': {
        description: 'Siempre `Export-Id, Content-Disposition`.',
        schema: { type: 'string' },
      },
    },
    content: {
      'text/plain': {
        schema: { type: 'string' },
        example: SIRE_FILE_EXAMPLE,
      },
    },
  })
  @ApiBadRequestResponse({
    type: ApiErrorBody,
    description:
      'Falta `X-User` o no es válido, el cuerpo no es válido (revisado antes de consultar), el periodo no tiene extranjeros o es demasiado grande, el movimiento no existe, un dato del huésped no se puede escribir, o una excepción inesperada. Nunca queda una `SireExport`.',
    examples: SIRE_EXPORT_ERROR_EXAMPLES,
  })
  @ApiTooManyRequestsResponse({
    type: ApiErrorBody,
    description:
      'El límite de solicitudes de la exportación, sin llegar a la base de datos (punto 13).',
    headers: {
      'Retry-After': {
        description:
          'Los segundos enteros que faltan para poder volver a intentar.',
        schema: { type: 'integer', minimum: 1 },
      },
    },
    examples: { TOO_MANY_REQUESTS: SIRE_TOO_MANY_REQUESTS_EXAMPLE },
  })
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
  @ApiOperation({
    summary:
      'Los movimientos de los huéspedes extranjeros del periodo, uno por huésped y tipo de movimiento, en el orden del archivo y en páginas de 50. Un periodo sin extranjeros no es un error. Solo lectura: no registra nada.',
  })
  // Nest aplica los decoradores de abajo hacia arriba: así OpenAPI los lista en el orden de la tabla de B.
  @ApiQuery({
    name: 'page',
    required: false,
    schema: { type: 'integer', minimum: 1, default: 1 },
    description: 'Por defecto `1`; tamaño fijo de 50.',
  })
  @ApiQuery({
    name: 'endDate',
    required: true,
    schema: { type: 'string', format: 'date' },
    description: 'Inclusiva. Las mismas reglas del periodo de la exportación.',
  })
  @ApiQuery({
    name: 'startDate',
    required: true,
    schema: { type: 'string', format: 'date' },
    description:
      'Inclusiva. Las mismas reglas del periodo de la exportación: máximo un año, contando las dos fechas.',
  })
  @ApiOkResponse({
    type: SireMovementPageDto,
    description:
      'La página pedida. Sin extranjeros: `items: []`, `totalItems: 0` y el mensaje.',
    examples: SIRE_MOVEMENTS_EXAMPLES,
  })
  @ApiBadRequestResponse({
    type: ApiErrorBody,
    description:
      'Un parámetro inválido, revisado antes de consultar, o una excepción inesperada.',
    examples: SIRE_MOVEMENTS_ERROR_EXAMPLES,
  })
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
  @ApiOperation({
    summary:
      'La línea de un movimiento tal como saldría en el archivo, con sus 12 campos. Solo lectura: no registra una `SireExport`.',
  })
  @ApiParam({
    name: 'movementId',
    schema: { type: 'string', format: 'uuid' },
    description: 'Un movimiento de un huésped extranjero.',
  })
  @ApiOkResponse({
    type: SireMovementPreviewDto,
    description: 'Los 12 campos en orden y la línea, sin el fin de línea.',
    example: SIRE_PREVIEW_EXAMPLE,
  })
  @ApiBadRequestResponse({
    type: ApiErrorBody,
    description:
      'El movimiento no existe, es de un colombiano o el id no es un UUID; un dato del huésped no se puede escribir; o una excepción inesperada.',
    examples: SIRE_PREVIEW_ERROR_EXAMPLES,
  })
  preview(
    @Param('movementId') movementId: string,
  ): Promise<SireMovementPreview> {
    return this.previewSireMovement.execute(movementId);
  }
}
