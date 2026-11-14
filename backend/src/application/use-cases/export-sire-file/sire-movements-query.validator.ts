import { BusinessError } from '../../../domain/shared/business-error.js';
import { INVALID_PAGE } from '../../../domain/shared/error-codes.js';
import type { SireMovementsQuery } from './ports/in/list-sire-movements.port.js';
import { assertValidSirePeriod, periodDate } from './sire-period.validator.js';

/** Un entero escrito solo con dígitos. */
const PAGE_FORMAT = /^\d+$/;

/**
 * Los parámetros de `GET /api/sire/movements` (plan, contrato B y tabla D), revisados antes de ejecutar
 * ninguna consulta (D3: "Validar el periodo y la página"). En este orden:
 * 1. El periodo, con las mismas reglas de A (`assertValidSirePeriod`): `INCOMPLETE_DATE_RANGE`,
 *    `INVALID_DATE`, `INVALID_DATE_RANGE` o `PERIOD_TOO_LARGE`. Un parámetro repetido llega como lista y es
 *    `INVALID_DATE`.
 * 2. `page`: por defecto `1`; si llega, un entero de 1 en adelante escrito solo con dígitos. Si no,
 *    `INVALID_PAGE`.
 *
 * Los parámetros ajenos se ignoran.
 * @throws BusinessError con el primero que falla.
 */
export function readSireMovementsQuery(
  query: unknown,
  maxPeriodDays: number,
): SireMovementsQuery {
  const params = isRecord(query) ? query : {};
  const startDate = periodDate(params.startDate);
  const endDate = periodDate(params.endDate);
  assertValidSirePeriod(startDate, endDate, maxPeriodDays);
  return {
    // assertValidSirePeriod ya comprobó que las dos vienen.
    startDate: startDate as string,
    endDate: endDate as string,
    page: readPage(params.page),
  };
}

function readPage(value: unknown): number {
  if (value === undefined) {
    return 1;
  }
  const page =
    typeof value === 'string' && PAGE_FORMAT.test(value)
      ? Number(value)
      : Number.NaN;
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new BusinessError(INVALID_PAGE.code, INVALID_PAGE.message);
  }
  return page;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
