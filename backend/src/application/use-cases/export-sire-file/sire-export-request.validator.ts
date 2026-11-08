import { BusinessError } from '../../../domain/shared/business-error.js';
import { INVALID_EXPORT_KIND, MOVEMENT_NOT_FOUND } from './error-codes.js';
import type { SireExportRequest } from './ports/in/export-sire-file.port.js';
import { assertValidSirePeriod } from './sire-period.validator.js';

/** Lo que no es texto: no tiene la forma `AAAA-MM-DD`, así que el validador responde `INVALID_DATE`. */
const NOT_A_DATE = 'no es una fecha';

/** UUID en su forma estándar `8-4-4-4-12` (hexadecimal), de cualquier versión. */
const UUID_FORMAT =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * El cuerpo de `POST /api/sire/exports` (plan, contrato A y tabla D), revisado antes de ejecutar ninguna
 * consulta (D1). En este orden:
 * 1. `exportKind`: `PERIOD` o `SINGLE_MOVEMENT`; si no, `INVALID_EXPORT_KIND`.
 * 2. En `PERIOD`, el periodo con `assertValidSirePeriod`: `INCOMPLETE_DATE_RANGE`, `INVALID_DATE`,
 *    `INVALID_DATE_RANGE` o `PERIOD_TOO_LARGE`, en ese orden. Una fecha que no es texto es `INVALID_DATE`.
 * 3. En `SINGLE_MOVEMENT`, el `movementId`: si falta o no es un UUID, `MOVEMENT_NOT_FOUND` ("tiene formato
 *    inválido").
 * @throws BusinessError con el primero que falla.
 */
export function readSireExportRequest(
  body: unknown,
  maxPeriodDays: number,
): SireExportRequest {
  const fields = isRecord(body) ? body : {};
  const { exportKind } = fields;
  if (exportKind === 'PERIOD') {
    const startDate = dateField(fields.startDate);
    const endDate = dateField(fields.endDate);
    assertValidSirePeriod(startDate, endDate, maxPeriodDays);
    // assertValidSirePeriod ya comprobó que las dos vienen.
    return {
      exportKind,
      startDate: startDate as string,
      endDate: endDate as string,
    };
  }
  if (exportKind === 'SINGLE_MOVEMENT') {
    const { movementId } = fields;
    if (typeof movementId !== 'string' || !UUID_FORMAT.test(movementId)) {
      throw new BusinessError(
        MOVEMENT_NOT_FOUND.code,
        MOVEMENT_NOT_FOUND.message,
      );
    }
    return { exportKind, movementId };
  }
  throw new BusinessError(
    INVALID_EXPORT_KIND.code,
    INVALID_EXPORT_KIND.message,
  );
}

/**
 * Una fecha del periodo tal como la revisa `assertValidSirePeriod`, que decide el orden de los errores:
 * ausente (`undefined` o `null`) cuenta como que falta, y lo que no es texto, como una fecha inválida.
 */
function dateField(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return typeof value === 'string' ? value : NOT_A_DATE;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
