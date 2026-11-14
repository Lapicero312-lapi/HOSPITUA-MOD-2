import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  INVALID_EXPORT_KIND,
  MOVEMENT_NOT_FOUND,
  NO_MIGRATORY_MOVEMENTS,
  PERIOD_TOO_LARGE,
  TOO_MANY_REQUESTS,
} from '../../../application/use-cases/export-sire-file/error-codes.js';
import {
  SIRE_MOVEMENTS_PAGE_SIZE,
  type SireMovementPage,
} from '../../../application/use-cases/export-sire-file/ports/in/list-sire-movements.port.js';
import type { SireMovementPreview } from '../../../application/use-cases/export-sire-file/ports/in/preview-sire-movement.port.js';
import {
  INCOMPLETE_DATE_RANGE,
  INVALID_DATE,
  INVALID_DATE_RANGE,
  INVALID_GUEST_CHARACTERS,
  INVALID_PAGE,
} from '../../../domain/shared/error-codes.js';
import {
  type ApiErrorBody,
  REQUEST_NOT_PROCESSED,
  REQUEST_NOT_PROCESSED_MESSAGE,
} from '../../shared/api-error.js';

/**
 * La documentación OpenAPI de "Exportar archivo SIRE" (plan de `export-sire-file`, contratos A, B y C, y
 * tabla D; T018). Las clases existen para que OpenAPI describa los cuerpos (plan base, "Contratos REST"): un
 * `type` no se puede leer. Los ejemplos son los del plan.
 */

const RESERVATION_REF_PATTERN = '^RSV-[0-9A-F]{8}$';

/** El cuerpo de A, `POST /api/sire/exports`. */
export class SireExportRequestDto {
  @ApiProperty({
    enum: ['PERIOD', 'SINGLE_MOVEMENT'],
    description:
      '`PERIOD`: los movimientos de extranjeros del periodo. `SINGLE_MOVEMENT`: un solo movimiento (la descarga individual).',
    example: 'PERIOD',
  })
  exportKind: string;

  @ApiPropertyOptional({
    type: String,
    format: 'date',
    description:
      'Obligatoria en `PERIOD`. `AAAA-MM-DD`, inclusiva; se compara con la `movementDate` de cada movimiento. El periodo es de máximo un año (`SIRE_MAX_PERIOD_DAYS`, contando las dos fechas).',
    example: '2026-10-01',
  })
  startDate?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'date',
    description: 'Obligatoria en `PERIOD`. `AAAA-MM-DD`, inclusiva.',
    example: '2026-10-31',
  })
  endDate?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    description:
      'Obligatorio en `SINGLE_MOVEMENT`: el movimiento de un huésped extranjero.',
    example: '4b6c1f0e-2d3a-4e5f-8a9b-0c1d2e3f4a5b',
  })
  movementId?: string;
}

/** Las dos solicitudes de ejemplo de A. */
export const SIRE_EXPORT_REQUEST_EXAMPLES = {
  PERIOD: {
    summary: 'El periodo completo',
    value: {
      exportKind: 'PERIOD',
      startDate: '2026-10-01',
      endDate: '2026-10-31',
    },
  },
  SINGLE_MOVEMENT: {
    summary: 'Un solo movimiento',
    value: {
      exportKind: 'SINGLE_MOVEMENT',
      movementId: '4b6c1f0e-2d3a-4e5f-8a9b-0c1d2e3f4a5b',
    },
  },
};

/**
 * El archivo del ejemplo de A: las dos líneas de John, con el separador, el formato de fecha y el fin de
 * línea por defecto (tabulador, `dd/MM/yyyy` y CRLF).
 */
export const SIRE_FILE_EXAMPLE = [
  '123456\t11001\tPAS\tX99\tEstados Unidos\tSMITH\tJOHN\tE\t09/10/2026\tMiami, Estados Unidos\tCartagena, Colombia\t12/05/1990',
  '123456\t11001\tPAS\tX99\tEstados Unidos\tSMITH\tJOHN\tS\t12/10/2026\tMiami, Estados Unidos\tCartagena, Colombia\t12/05/1990',
]
  .map((line) => `${line}\r\n`)
  .join('');

/** El huésped de un elemento de B: sin la fecha de nacimiento ni los lugares. */
export class SireMovementGuestDto {
  @ApiProperty({
    description: 'Nombres y apellidos tal como se guardaron.',
    example: 'John Smith',
  })
  fullName: string;

  @ApiProperty({ example: 'PAS' })
  documentType: string;

  @ApiProperty({ example: 'X99' })
  documentNumber: string;

  @ApiProperty({ example: 'Estados Unidos' })
  nationality: string;
}

/** Un elemento de B: un huésped extranjero y un tipo de movimiento. */
export class SireMovementItemDto {
  @ApiProperty({ format: 'uuid' })
  movementId: string;

  @ApiProperty({ pattern: RESERVATION_REF_PATTERN, example: 'RSV-3F9A1C7B' })
  reservationRef: string;

  @ApiProperty({ type: SireMovementGuestDto })
  guest: SireMovementGuestDto;

  @ApiProperty({ enum: ['ENTRY', 'DEPARTURE'], example: 'ENTRY' })
  movementType: string;

  @ApiProperty({ format: 'date', example: '2026-10-09' })
  movementDate: string;
}

/** La respuesta de B, `GET /api/sire/movements`. */
export class SireMovementPageDto {
  @ApiProperty({
    type: [SireMovementItemDto],
    description:
      'Uno por huésped extranjero y tipo de movimiento, en el orden del archivo; los colombianos no aparecen. Sin extranjeros, `[]`.',
  })
  items: SireMovementItemDto[];

  @ApiProperty({
    type: 'integer',
    minimum: 1,
    description:
      'La página devuelta: una que no existe se ajusta a la última válida.',
    example: 1,
  })
  page: number;

  @ApiProperty({
    type: 'integer',
    description: 'Tamaño fijo.',
    example: SIRE_MOVEMENTS_PAGE_SIZE,
  })
  pageSize: number;

  @ApiProperty({ type: 'integer', minimum: 0, example: 2 })
  totalItems: number;

  @ApiProperty({
    type: 'integer',
    minimum: 0,
    description: '`0` sin extranjeros.',
    example: 1,
  })
  totalPages: number;

  @ApiProperty({
    type: String,
    nullable: true,
    description: `Sin extranjeros, "${NO_MIGRATORY_MOVEMENTS.message}"; si no, \`null\`.`,
    example: null,
  })
  message: string | null;
}

const JOHN_GUEST = {
  fullName: 'John Smith',
  documentType: 'PAS',
  documentNumber: 'X99',
  nationality: 'Estados Unidos',
};

/** Los dos ejemplos de B: el periodo del ejemplo de A, y uno sin extranjeros. */
export const SIRE_MOVEMENTS_EXAMPLES = {
  WITH_MOVEMENTS: {
    summary: 'Con movimientos',
    value: {
      items: [
        {
          movementId: '4b6c1f0e-2d3a-4e5f-8a9b-0c1d2e3f4a5b',
          reservationRef: 'RSV-3F9A1C7B',
          guest: JOHN_GUEST,
          movementType: 'ENTRY',
          movementDate: '2026-10-09',
        },
        {
          movementId: 'c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f',
          reservationRef: 'RSV-3F9A1C7B',
          guest: JOHN_GUEST,
          movementType: 'DEPARTURE',
          movementDate: '2026-10-12',
        },
      ],
      page: 1,
      pageSize: SIRE_MOVEMENTS_PAGE_SIZE,
      totalItems: 2,
      totalPages: 1,
      message: null,
    } satisfies SireMovementPage,
  },
  WITHOUT_FOREIGNERS: {
    summary: 'Un periodo sin extranjeros (no es un error)',
    value: {
      items: [],
      page: 1,
      pageSize: SIRE_MOVEMENTS_PAGE_SIZE,
      totalItems: 0,
      totalPages: 0,
      message: NO_MIGRATORY_MOVEMENTS.message,
    } satisfies SireMovementPage,
  },
};

/** Un campo de la línea de C, en el orden del archivo. */
export class SireFieldDto {
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 12, example: 1 })
  position: number;

  @ApiProperty({ example: 'Código del hotel' })
  name: string;

  @ApiProperty({
    description:
      'Como va en el archivo: nombres en mayúsculas y fechas con `SIRE_DATE_FORMAT`.',
    example: '123456',
  })
  value: string;
}

/** La respuesta de C, `GET /api/sire/movements/{movementId}/preview`. */
export class SireMovementPreviewDto {
  @ApiProperty({ format: 'uuid' })
  movementId: string;

  @ApiProperty({ pattern: RESERVATION_REF_PATTERN, example: 'RSV-3F9A1C7B' })
  reservationRef: string;

  @ApiProperty({
    type: [SireFieldDto],
    description: 'Los 12 campos, en orden.',
  })
  fields: SireFieldDto[];

  @ApiProperty({
    description:
      'La línea tal como saldría en el archivo, sin el fin de línea.',
  })
  line: string;
}

/** El ejemplo de C del plan: la entrada de John. */
export const SIRE_PREVIEW_EXAMPLE = {
  movementId: '4b6c1f0e-2d3a-4e5f-8a9b-0c1d2e3f4a5b',
  reservationRef: 'RSV-3F9A1C7B',
  fields: [
    { position: 1, name: 'Código del hotel', value: '123456' },
    { position: 2, name: 'Código de la ciudad', value: '11001' },
    { position: 3, name: 'Tipo de documento', value: 'PAS' },
    { position: 4, name: 'Número de documento', value: 'X99' },
    { position: 5, name: 'Nacionalidad', value: 'Estados Unidos' },
    { position: 6, name: 'Apellidos', value: 'SMITH' },
    { position: 7, name: 'Nombres', value: 'JOHN' },
    { position: 8, name: 'Tipo de movimiento', value: 'E' },
    { position: 9, name: 'Fecha del movimiento', value: '09/10/2026' },
    {
      position: 10,
      name: 'Lugar de procedencia',
      value: 'Miami, Estados Unidos',
    },
    { position: 11, name: 'Lugar de destino', value: 'Cartagena, Colombia' },
    { position: 12, name: 'Fecha de nacimiento', value: '12/05/1990' },
  ],
  line: '123456\t11001\tPAS\tX99\tEstados Unidos\tSMITH\tJOHN\tE\t09/10/2026\tMiami, Estados Unidos\tCartagena, Colombia\t12/05/1990',
} satisfies SireMovementPreview;

/** Un ejemplo de error de la ruta `path`, con el cuerpo de la API. */
function errorExample(
  path: string,
  summary: string,
  errorCode: string,
  message: string,
) {
  return {
    summary,
    value: {
      errorCode,
      message,
      timestamp: '2026-10-11T15:00:00.000Z',
      path,
    } satisfies ApiErrorBody,
  };
}

const EXPORTS_PATH = '/api/sire/exports';
const MOVEMENTS_PATH = '/api/sire/movements';
const PREVIEW_PATH =
  '/api/sire/movements/4b6c1f0e-2d3a-4e5f-8a9b-0c1d2e3f4a5b/preview';

/** Los errores del periodo, comunes a A y B (tabla D: "Mismas reglas del periodo"). */
function periodErrors(path: string) {
  return {
    [INCOMPLETE_DATE_RANGE.code]: errorExample(
      path,
      'Falta `startDate` o `endDate`',
      INCOMPLETE_DATE_RANGE.code,
      INCOMPLETE_DATE_RANGE.message,
    ),
    [INVALID_DATE.code]: errorExample(
      path,
      'Fecha mal formada o inexistente',
      INVALID_DATE.code,
      INVALID_DATE.message,
    ),
    [INVALID_DATE_RANGE.code]: errorExample(
      path,
      '`startDate` posterior a `endDate`',
      INVALID_DATE_RANGE.code,
      INVALID_DATE_RANGE.message,
    ),
  };
}

const unexpected = (path: string) => ({
  [REQUEST_NOT_PROCESSED]: errorExample(
    path,
    'Una excepción inesperada',
    REQUEST_NOT_PROCESSED,
    REQUEST_NOT_PROCESSED_MESSAGE,
  ),
});

/**
 * Los errores `400` de A, en el orden en que se revisan (D1): `X-User`, el cuerpo y la exportación. Ninguno
 * deja una `SireExport`.
 */
export const SIRE_EXPORT_ERROR_EXAMPLES = {
  USER_REQUIRED: errorExample(
    EXPORTS_PATH,
    'Falta la cabecera `X-User`',
    'USER_REQUIRED',
    'Falta el usuario que hace la acción.',
  ),
  INVALID_USER: errorExample(
    EXPORTS_PATH,
    '`X-User` de más de 100 caracteres',
    'INVALID_USER',
    'El usuario que hace la acción no es válido.',
  ),
  [INVALID_EXPORT_KIND.code]: errorExample(
    EXPORTS_PATH,
    '`exportKind` distinto de `PERIOD` o `SINGLE_MOVEMENT`',
    INVALID_EXPORT_KIND.code,
    INVALID_EXPORT_KIND.message,
  ),
  ...periodErrors(EXPORTS_PATH),
  [PERIOD_TOO_LARGE.code]: errorExample(
    EXPORTS_PATH,
    'Periodo de más de un año, o de más de `SIRE_MAX_RECORDS` líneas',
    PERIOD_TOO_LARGE.code,
    PERIOD_TOO_LARGE.message,
  ),
  [MOVEMENT_NOT_FOUND.code]: errorExample(
    EXPORTS_PATH,
    'El `movementId` no existe, es de un colombiano o tiene formato inválido',
    MOVEMENT_NOT_FOUND.code,
    MOVEMENT_NOT_FOUND.message,
  ),
  [NO_MIGRATORY_MOVEMENTS.code]: errorExample(
    EXPORTS_PATH,
    'El periodo no tiene movimientos de extranjeros: no se genera el archivo',
    NO_MIGRATORY_MOVEMENTS.code,
    NO_MIGRATORY_MOVEMENTS.message,
  ),
  [INVALID_GUEST_CHARACTERS.code]: errorExample(
    EXPORTS_PATH,
    'Un dato del huésped no se puede escribir en el archivo',
    INVALID_GUEST_CHARACTERS.code,
    INVALID_GUEST_CHARACTERS.message,
  ),
  ...unexpected(EXPORTS_PATH),
};

/** El `429` de A: el límite de solicitudes de la exportación (punto 13). */
export const SIRE_TOO_MANY_REQUESTS_EXAMPLE = {
  summary:
    'Más de `SIRE_RATE_LIMIT_PER_MINUTE` solicitudes del mismo `X-User` en un minuto, o más de `SIRE_MAX_CONCURRENT` simultáneas',
  value: {
    errorCode: TOO_MANY_REQUESTS.code,
    message: TOO_MANY_REQUESTS.message,
    timestamp: '2026-10-11T15:00:00.000Z',
    path: EXPORTS_PATH,
  } satisfies ApiErrorBody,
};

/** Los errores `400` de B, revisados antes de consultar (D3). */
export const SIRE_MOVEMENTS_ERROR_EXAMPLES = {
  ...periodErrors(MOVEMENTS_PATH),
  [PERIOD_TOO_LARGE.code]: errorExample(
    MOVEMENTS_PATH,
    'Periodo de más de un año',
    PERIOD_TOO_LARGE.code,
    PERIOD_TOO_LARGE.message,
  ),
  [INVALID_PAGE.code]: errorExample(
    MOVEMENTS_PATH,
    '`page` que no es un entero de 1 en adelante',
    INVALID_PAGE.code,
    INVALID_PAGE.message,
  ),
  ...unexpected(MOVEMENTS_PATH),
};

/** Los errores `400` de C. */
export const SIRE_PREVIEW_ERROR_EXAMPLES = {
  [MOVEMENT_NOT_FOUND.code]: errorExample(
    PREVIEW_PATH,
    'El movimiento no existe, es de un colombiano o el id no es un UUID',
    MOVEMENT_NOT_FOUND.code,
    MOVEMENT_NOT_FOUND.message,
  ),
  [INVALID_GUEST_CHARACTERS.code]: errorExample(
    PREVIEW_PATH,
    'Un dato del huésped no se puede escribir en el archivo',
    INVALID_GUEST_CHARACTERS.code,
    INVALID_GUEST_CHARACTERS.message,
  ),
  ...unexpected(PREVIEW_PATH),
};
