import { plainToInstance, Transform } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  ValidateBy,
  validateSync,
} from 'class-validator';
import {
  AGENCY_REQUIRES_OTA_CHANNEL,
  INVALID_CHANNEL,
  INVALID_CONFLICT_FILTER,
  INVALID_OTA_ID,
  INVALID_SORT_ORDER,
} from '../../../application/use-cases/check-view-reservation/error-codes.js';
import { BusinessError } from '../../../domain/shared/business-error.js';
import {
  RESERVATION_SOURCES,
  RESERVATION_STATUSES,
  type ReservationSource,
  type ReservationStatus,
} from '../../../domain/shared/enums.js';
import {
  DATE_RANGE_TOO_LARGE,
  INCOMPLETE_DATE_RANGE,
  INVALID_DATE,
  INVALID_DATE_RANGE,
  INVALID_PAGE,
  INVALID_RESERVATION_CODE,
  INVALID_STATUS,
} from '../../../domain/shared/error-codes.js';

type ErrorCode = { readonly code: string; readonly message: string };

/** Máximo del rango de estadía, contando el primer y el último día (C1). */
const MAX_RANGE_DAYS = 366;
const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;
const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;
/**
 * "Algoritmo de búsqueda", paso 2: no vacío, máximo 40 caracteres y solo letras (con tildes y `ñ`),
 * dígitos y guion, sin espacios internos.
 */
const SEARCH_FORMAT = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9-]{1,40}$/;
/** UUID en su forma estándar `8-4-4-4-12` (hexadecimal), de cualquier versión. */
export const UUID_FORMAT =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Una fecha `AAAA-MM-DD` que existe en el calendario. */
function IsRealDate(): PropertyDecorator {
  return ValidateBy({
    name: 'isRealDate',
    validator: { validate: isRealDate },
  });
}

/** Un entero de 1 en adelante, escrito solo con dígitos. */
function IsPageNumber(): PropertyDecorator {
  return ValidateBy({
    name: 'isPageNumber',
    validator: {
      validate: (value: unknown) =>
        typeof value === 'string' &&
        /^\d+$/.test(value) &&
        Number(value) >= 1 &&
        Number.isSafeInteger(Number(value)),
    },
  });
}

/**
 * Los parámetros de `GET /api/reservations` para la Recepcionista (C1), tal como llegan. Un parámetro
 * repetido llega como lista y no es válido. Los parámetros ajenos se ignoran (solo el Módulo 1 los
 * rechaza, en C5).
 */
export class ReservationListQueryDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Matches(SEARCH_FORMAT)
  search?: unknown;

  @IsOptional()
  @IsIn(RESERVATION_STATUSES)
  status?: unknown;

  @IsOptional()
  @IsIn(RESERVATION_SOURCES)
  source?: unknown;

  @IsOptional()
  @IsString()
  @Matches(UUID_FORMAT)
  otaId?: unknown;

  @IsOptional()
  @IsIn(['true'])
  inConflict?: unknown;

  @IsOptional()
  @IsRealDate()
  dateFrom?: unknown;

  @IsOptional()
  @IsRealDate()
  dateTo?: unknown;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: unknown;

  @IsOptional()
  @IsPageNumber()
  page?: unknown;
}

type QueryField = keyof ReservationListQueryDto;

/** El error de la tabla de C1 que responde cada parámetro cuando no cumple su formato. */
const FIELD_ERRORS: Readonly<Record<QueryField, ErrorCode>> = {
  search: INVALID_RESERVATION_CODE,
  status: INVALID_STATUS,
  source: INVALID_CHANNEL,
  otaId: INVALID_OTA_ID,
  inConflict: INVALID_CONFLICT_FILTER,
  dateFrom: INVALID_DATE,
  dateTo: INVALID_DATE,
  order: INVALID_SORT_ORDER,
  page: INVALID_PAGE,
};

/** Los filtros de C1 ya revisados, con sus valores por defecto. */
export type ReservationListQuery = {
  /** Sin los espacios de los extremos; `null` si no viene. Su algoritmo es de T006. */
  search: string | null;
  status: ReservationStatus | null;
  source: ReservationSource | null;
  otaId: string | null;
  inConflict: boolean;
  stayRange: { dateFrom: string; dateTo: string } | null;
  order: 'asc' | 'desc';
  page: number;
};

/**
 * Revisa los parámetros de C1 antes de consultar, en el orden del plan ("Orden de validación"): formato
 * de `search` → `status` → `source` → `otaId` (formato y canal) → `inConflict` → fechas (formato,
 * completitud, orden y 366 días) → `order` → `page`. El primero que falla responde. La longitud del
 * nombre, la última del orden, depende de cómo se clasifique la búsqueda: es de T006 y T021.
 * @throws BusinessError con el código y el mensaje de la tabla de errores de C1.
 */
export function readReservationListQuery(
  query: Record<string, unknown>,
): ReservationListQuery {
  const dto = plainToInstance(ReservationListQueryDto, query);
  // Qué parámetros no cumplen su formato (`class-validator`); el orden lo pone la secuencia de abajo.
  const failed = new Set(
    validateSync(dto, { stopAtFirstError: true }).map(
      (error) => error.property,
    ),
  );
  const check = (field: QueryField) => {
    if (failed.has(field)) {
      throw errorOf(FIELD_ERRORS[field]);
    }
  };

  check('search');
  check('status');
  check('source');
  check('otaId');
  if (dto.otaId !== undefined && dto.source !== 'OTA') {
    throw errorOf(AGENCY_REQUIRES_OTA_CHANNEL);
  }
  check('inConflict');
  check('dateFrom');
  check('dateTo');
  const stayRange = readStayRange(dto.dateFrom, dto.dateTo);
  check('order');
  check('page');

  // Ya revisados: cada uno es undefined o un valor permitido.
  return {
    search: (dto.search as string | undefined) ?? null,
    status: (dto.status as ReservationStatus | undefined) ?? null,
    source: (dto.source as ReservationSource | undefined) ?? null,
    otaId: (dto.otaId as string | undefined) ?? null,
    inConflict: dto.inConflict === 'true',
    stayRange,
    order: (dto.order as 'asc' | 'desc' | undefined) ?? 'desc',
    page: dto.page === undefined ? 1 : Number(dto.page),
  };
}

/** Las dos fechas o ninguna; ya tienen formato válido. También la usa la consulta del Módulo 1 (C5). */
export function readStayRange(
  dateFrom: unknown,
  dateTo: unknown,
): ReservationListQuery['stayRange'] {
  if (dateFrom === undefined && dateTo === undefined) {
    return null;
  }
  if (typeof dateFrom !== 'string' || typeof dateTo !== 'string') {
    throw errorOf(INCOMPLETE_DATE_RANGE);
  }
  // En `AAAA-MM-DD`, el orden del texto es el de las fechas.
  if (dateFrom > dateTo) {
    throw errorOf(INVALID_DATE_RANGE);
  }
  const days =
    (Date.parse(`${dateTo}T00:00:00Z`) - Date.parse(`${dateFrom}T00:00:00Z`)) /
      DAY_IN_MILLISECONDS +
    1;
  if (days > MAX_RANGE_DAYS) {
    throw errorOf(DATE_RANGE_TOO_LARGE);
  }
  return { dateFrom, dateTo };
}

function errorOf(error: ErrorCode): BusinessError {
  return new BusinessError(error.code, error.message);
}

/**
 * La fecha existe en el calendario: con un día o un mes fuera de rango (por ejemplo `2026-13-01`),
 * `Date` no la puede crear; con un día que ese mes no tiene (por ejemplo `2026-02-30`), la corre al mes
 * siguiente y deja de coincidir. Se lee en UTC para que no dependa de la zona horaria del computador.
 */
export function isRealDate(value: unknown): boolean {
  if (typeof value !== 'string' || !DATE_FORMAT.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}
