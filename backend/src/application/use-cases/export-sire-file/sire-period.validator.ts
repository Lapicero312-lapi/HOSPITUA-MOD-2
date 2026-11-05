import { BusinessError } from '../../../domain/shared/business-error.js';
import {
  INCOMPLETE_DATE_RANGE,
  INVALID_DATE,
  INVALID_DATE_RANGE,
} from '../../../domain/shared/error-codes.js';
import { PERIOD_TOO_LARGE } from './error-codes.js';

const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;
const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;

/**
 * El periodo de la exportación y del listado (plan, A y B: "Mismas reglas del periodo"), sin ejecutar
 * ninguna consulta. Revisa en el orden del plan: obligatorio, fechas reales, orden y máximo. Las dos
 * fechas cuentan, así que del 1 al 1 del mismo mes es un día.
 * @throws BusinessError `INCOMPLETE_DATE_RANGE`, `INVALID_DATE`, `INVALID_DATE_RANGE` o `PERIOD_TOO_LARGE`.
 */
export function assertValidSirePeriod(
  startDate: string | undefined,
  endDate: string | undefined,
  maxPeriodDays: number,
): void {
  if (
    startDate === undefined ||
    endDate === undefined ||
    startDate === '' ||
    endDate === ''
  ) {
    throw new BusinessError(
      INCOMPLETE_DATE_RANGE.code,
      INCOMPLETE_DATE_RANGE.message,
    );
  }
  if (!isRealDate(startDate) || !isRealDate(endDate)) {
    throw new BusinessError(INVALID_DATE.code, INVALID_DATE.message);
  }
  // En `AAAA-MM-DD`, el orden del texto es el de las fechas.
  if (startDate > endDate) {
    throw new BusinessError(
      INVALID_DATE_RANGE.code,
      INVALID_DATE_RANGE.message,
    );
  }
  if (daysIn(startDate, endDate) > maxPeriodDays) {
    throw new BusinessError(PERIOD_TOO_LARGE.code, PERIOD_TOO_LARGE.message);
  }
}

/** Los días del periodo, contando el primero y el último. */
function daysIn(startDate: string, endDate: string): number {
  const elapsed =
    Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`);
  return elapsed / DAY_IN_MILLISECONDS + 1;
}

/**
 * La fecha existe en el calendario: con un día o un mes fuera de rango (por ejemplo `2026-13-01`),
 * `Date` no la puede crear; con un día que ese mes no tiene (por ejemplo `2026-02-30`), la corre al
 * siguiente y deja de coincidir. Se lee en UTC para que no dependa de la zona horaria del computador.
 */
function isRealDate(value: string): boolean {
  if (!DATE_FORMAT.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}
