import { BusinessError } from '../../../domain/shared/business-error.js';
import {
  DATE_RANGE_TOO_LARGE,
  INCOMPLETE_DATE_RANGE,
  INVALID_DATE,
  INVALID_DATE_RANGE,
  INVALID_PAGE,
  INVALID_RESERVATION_CODE,
  NAME_SEARCH_TOO_SHORT,
} from '../../../domain/shared/error-codes.js';
import {
  INVALID_DOCUMENT_NUMBER,
  INVALID_NATIONALITY_FILTER,
  INVALID_PRESENCE_FILTER,
  INVALID_SEARCH,
} from './error-codes.js';

const NATIONALITY_FILTERS = ['ALL', 'FOREIGN', 'COLOMBIAN'] as const;
const PRESENCE_FILTERS = ['ALL', 'IN_HOTEL', 'CHECKED_OUT'] as const;

export type NationalityFilter = (typeof NATIONALITY_FILTERS)[number];
export type PresenceFilter = (typeof PRESENCE_FILTERS)[number];

/** Máximo del rango de fechas, contando el primer y el último día (C1). */
const MAX_RANGE_DAYS = 366;
const MIN_NAME_LENGTH = 3;
const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;

const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;
const PAGE_FORMAT = /^\d+$/;
/** `RSV-` y 8 caracteres hexadecimales en mayúscula (plan base). */
const RESERVATION_REF_FORMAT = /^RSV-[0-9A-F]{8}$/;
/**
 * Letras (con tildes y `ñ`), dígitos y guion: los caracteres de la búsqueda de `check-view-reservation`
 * (FR-009) y del documento de `generate-direct-reservation` (punto 9).
 */
const SEARCH_CHARACTERS = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9-]+$/;
const DIGIT = /\d/;

/** Lo que se busca: un documento exacto (con algún dígito) o un nombre parcial (sin dígitos). */
export type GuestStaySearch =
  { kind: 'DOCUMENT'; documentNumber: string } | { kind: 'NAME'; text: string };

/** Los filtros de C1 ya revisados, con sus valores por defecto. */
export type GuestStayFilters = {
  nationality: NationalityFilter;
  presence: PresenceFilter;
  /** Los dos o ninguno: `AAAA-MM-DD`. */
  dateRange: { dateFrom: string; dateTo: string } | null;
  search: GuestStaySearch | null;
  page: number;
};

/** Los parámetros de C1 tal como llegan en la consulta (un parámetro repetido llega como lista). */
export type GuestStayQueryParams = {
  nationality?: unknown;
  presence?: unknown;
  dateFrom?: unknown;
  dateTo?: unknown;
  search?: unknown;
  page?: unknown;
};

/**
 * Revisa los filtros de `GET /api/guest-stays` (C1) antes de consultar, en el orden de su tabla de
 * errores: nacionalidad, situación, fechas, búsqueda y página. El primero que falla da el error. Un
 * parámetro que no viene toma su valor por defecto; uno repetido no es válido.
 * @throws BusinessError con el código y el mensaje de la tabla de errores de C1.
 */
export function readGuestStayFilters(
  params: GuestStayQueryParams,
): GuestStayFilters {
  return {
    nationality: readEnum(
      params.nationality,
      NATIONALITY_FILTERS,
      INVALID_NATIONALITY_FILTER,
    ),
    presence: readEnum(
      params.presence,
      PRESENCE_FILTERS,
      INVALID_PRESENCE_FILTER,
    ),
    dateRange: readDateRange(params.dateFrom, params.dateTo),
    search: readSearch(params.search),
    page: readPage(params.page),
  };
}

/**
 * Revisa los parámetros de la ruta del detalle (C2), en orden: primero la reserva y después el
 * documento.
 * @throws BusinessError `INVALID_RESERVATION_CODE` o `INVALID_DOCUMENT_NUMBER`.
 */
export function readGuestStayKey(
  reservationRef: unknown,
  documentNumber: unknown,
): { reservationRef: string; documentNumber: string } {
  if (
    typeof reservationRef !== 'string' ||
    !RESERVATION_REF_FORMAT.test(reservationRef)
  ) {
    throw errorOf(INVALID_RESERVATION_CODE);
  }
  if (
    typeof documentNumber !== 'string' ||
    !SEARCH_CHARACTERS.test(documentNumber)
  ) {
    throw errorOf(INVALID_DOCUMENT_NUMBER);
  }
  return { reservationRef, documentNumber };
}

function readEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  error: { code: string; message: string },
): T {
  if (value === undefined) {
    return allowed[0];
  }
  if (!(allowed as readonly unknown[]).includes(value)) {
    throw errorOf(error);
  }
  return value as T;
}

function readDateRange(
  dateFrom: unknown,
  dateTo: unknown,
): GuestStayFilters['dateRange'] {
  if (dateFrom === undefined && dateTo === undefined) {
    return null;
  }
  if (dateFrom === undefined || dateTo === undefined) {
    throw errorOf(INCOMPLETE_DATE_RANGE);
  }
  if (!isRealDate(dateFrom) || !isRealDate(dateTo)) {
    throw errorOf(INVALID_DATE);
  }
  // En `AAAA-MM-DD`, el orden del texto es el de las fechas.
  if (dateFrom > dateTo) {
    throw errorOf(INVALID_DATE_RANGE);
  }
  if (daysIn(dateFrom, dateTo) > MAX_RANGE_DAYS) {
    throw errorOf(DATE_RANGE_TOO_LARGE);
  }
  return { dateFrom, dateTo };
}

/**
 * Sin los espacios de los extremos. Con algún dígito es un documento exacto; sin dígitos, un nombre de
 * al menos 3 caracteres.
 */
function readSearch(value: unknown): GuestStaySearch | null {
  if (value === undefined) {
    return null;
  }
  const text = typeof value === 'string' ? value.trim() : null;
  if (text === null || !SEARCH_CHARACTERS.test(text)) {
    throw errorOf(INVALID_SEARCH);
  }
  if (DIGIT.test(text)) {
    return { kind: 'DOCUMENT', documentNumber: text };
  }
  if (text.length < MIN_NAME_LENGTH) {
    throw errorOf(NAME_SEARCH_TOO_SHORT);
  }
  return { kind: 'NAME', text };
}

/** Un entero de 1 en adelante, escrito solo con dígitos. */
function readPage(value: unknown): number {
  if (value === undefined) {
    return 1;
  }
  if (typeof value !== 'string' || !PAGE_FORMAT.test(value)) {
    throw errorOf(INVALID_PAGE);
  }
  const page = Number(value);
  if (page < 1 || !Number.isSafeInteger(page)) {
    throw errorOf(INVALID_PAGE);
  }
  return page;
}

function errorOf(error: { code: string; message: string }): BusinessError {
  return new BusinessError(error.code, error.message);
}

/** Los días del rango, contando el primero y el último. */
function daysIn(dateFrom: string, dateTo: string): number {
  const elapsed =
    Date.parse(`${dateTo}T00:00:00Z`) - Date.parse(`${dateFrom}T00:00:00Z`);
  return elapsed / DAY_IN_MILLISECONDS + 1;
}

/**
 * La fecha existe en el calendario: con un día o un mes fuera de rango (por ejemplo `2026-13-01`),
 * `Date` no la puede crear; con un día que ese mes no tiene (por ejemplo `2026-02-30`), la corre al mes
 * siguiente y deja de coincidir. Se lee en UTC para que no dependa de la zona horaria del computador.
 */
function isRealDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_FORMAT.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}
