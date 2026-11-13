import type {
  OtaCommissionFilters,
  OtaCommissionPage,
  OtaCommissionRow,
} from '../../../application/use-cases/register-ota-information-commission/ports/in/list-ota-commissions.port.js';
import {
  INVALID_COMMISSION_STATUS,
  OTA_NOT_FOUND,
} from '../../../application/use-cases/register-ota-information-commission/error-codes.js';
import { BusinessError } from '../../../domain/shared/business-error.js';
import {
  COMMISSION_STATUSES,
  type CommissionStatus,
  RESERVATION_STATUSES,
  type ReservationStatus,
} from '../../../domain/shared/enums.js';
import {
  DATE_RANGE_TOO_LARGE,
  INCOMPLETE_DATE_RANGE,
  INVALID_DATE,
  INVALID_DATE_RANGE,
  INVALID_PAGE,
  INVALID_STATUS,
} from '../../../domain/shared/error-codes.js';
import { isRealDate, UUID_FORMAT } from './reservation-list-query.dto.js';

type ErrorCode = { readonly code: string; readonly message: string };

/** El rango más largo de A1, en días, contando los dos extremos. */
const MAX_RANGE_DAYS = 366;
const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;

/** Los parámetros de A1 ya revisados: los filtros y la página. */
export type OtaCommissionQuery = {
  filters: OtaCommissionFilters;
  page: number;
};

/**
 * Revisa los parámetros de `GET /api/ota-commissions` (plan de `register-ota-information-commission`, A1 y
 * punto C1) en este orden; el primero que falla responde. Un parámetro repetido llega como lista y no es
 * válido. Los parámetros ajenos se ignoran.
 * 1. Las fechas: falta una o las dos, `INCOMPLETE_DATE_RANGE`; una que no es una `AAAA-MM-DD` real,
 *    `INVALID_DATE`; `dateFrom` posterior a `dateTo`, `INVALID_DATE_RANGE`; más de 366 días,
 *    `DATE_RANGE_TOO_LARGE`.
 * 2. `commissionStatus`: `INVALID_COMMISSION_STATUS`.
 * 3. `reservationStatus`: `INVALID_STATUS`.
 * 4. `otaId` que no es un UUID: `OTA_NOT_FOUND`.
 * 5. `page` que no es un entero de 1 en adelante: `INVALID_PAGE`.
 * @throws BusinessError con el código del primero que falla.
 */
export function readOtaCommissionQuery(
  query: Record<string, unknown>,
): OtaCommissionQuery {
  const { dateFrom, dateTo } = readDates(query.dateFrom, query.dateTo);
  const commissionStatus = readOneOf<CommissionStatus>(
    query.commissionStatus,
    COMMISSION_STATUSES,
    INVALID_COMMISSION_STATUS,
  );
  const reservationStatus = readOneOf<ReservationStatus>(
    query.reservationStatus,
    RESERVATION_STATUSES,
    INVALID_STATUS,
  );
  const otaId = readOtaId(query.otaId);
  const page = readPage(query.page);
  return {
    filters: { dateFrom, dateTo, commissionStatus, reservationStatus, otaId },
    page,
  };
}

function readDates(
  dateFrom: unknown,
  dateTo: unknown,
): { dateFrom: string; dateTo: string } {
  if (dateFrom === undefined || dateTo === undefined) {
    throw errorOf(INCOMPLETE_DATE_RANGE);
  }
  if (!isRealDate(dateFrom) || !isRealDate(dateTo)) {
    throw errorOf(INVALID_DATE);
  }
  const from = dateFrom as string;
  const to = dateTo as string;
  // En `AAAA-MM-DD`, el orden del texto es el de las fechas.
  if (from > to) {
    throw errorOf(INVALID_DATE_RANGE);
  }
  const days =
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      DAY_IN_MILLISECONDS +
    1;
  if (days > MAX_RANGE_DAYS) {
    throw errorOf(DATE_RANGE_TOO_LARGE);
  }
  return { dateFrom: from, dateTo: to };
}

/** Un filtro opcional que tiene que ser uno de `values`; sin valor, `null` (todos). */
function readOneOf<T extends string>(
  value: unknown,
  values: readonly string[],
  error: ErrorCode,
): T | null {
  if (value === undefined) {
    return null;
  }
  if (typeof value !== 'string' || !values.includes(value)) {
    throw errorOf(error);
  }
  return value as T;
}

/** Uno que no es un UUID no puede ser una agencia: `OTA_NOT_FOUND`. Uno que no existe da `items: []`. */
function readOtaId(value: unknown): string | null {
  if (value === undefined) {
    return null;
  }
  if (typeof value !== 'string' || !UUID_FORMAT.test(value)) {
    throw errorOf(OTA_NOT_FOUND);
  }
  return value;
}

function readPage(value: unknown): number {
  if (value === undefined) {
    return 1;
  }
  if (
    typeof value !== 'string' ||
    !/^\d+$/.test(value) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) < 1
  ) {
    throw errorOf(INVALID_PAGE);
  }
  return Number(value);
}

function errorOf(error: ErrorCode): BusinessError {
  return new BusinessError(error.code, error.message);
}

/** Una comisión en A1: los importes con dos decimales y el porcentaje como número JSON. */
export type OtaCommissionBody = {
  reservationRef: string;
  otaId: string;
  otaName: string;
  externalConfirmationCode: string;
  status: ReservationStatus;
  startDate: string;
  endDate: string;
  grossAmount: { amount: string; currency: string };
  commissionPercentage: number;
  commissionAmount: { amount: string; currency: string };
  commissionStatus: CommissionStatus;
};

/** La respuesta 200 de A1. */
export type OtaCommissionPageBody = {
  items: OtaCommissionBody[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
};

/** Convierte la página de `ListOtaCommissions` en el JSON de A1. */
export function toOtaCommissionPageBody(
  result: OtaCommissionPage,
): OtaCommissionPageBody {
  return {
    items: result.items.map(toOtaCommissionBody),
    page: result.page,
    pageSize: result.pageSize,
    totalItems: result.totalItems,
    totalPages: result.totalPages,
  };
}

function toOtaCommissionBody(row: OtaCommissionRow): OtaCommissionBody {
  return {
    reservationRef: row.reservationRef,
    otaId: row.otaId,
    otaName: row.otaName,
    externalConfirmationCode: row.externalConfirmationCode,
    status: row.status,
    startDate: row.startDate,
    endDate: row.endDate,
    grossAmount: {
      amount: row.grossAmount.amountWithCents,
      currency: row.grossAmount.currency,
    },
    commissionPercentage: Number(row.commissionPercentage),
    commissionAmount: {
      amount: row.commissionAmount.amountWithCents,
      currency: row.commissionAmount.currency,
    },
    commissionStatus: row.commissionStatus,
  };
}
