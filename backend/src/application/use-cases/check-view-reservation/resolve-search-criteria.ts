import { BusinessError } from '../../../domain/shared/business-error.js';
import {
  INVALID_RESERVATION_CODE,
  NAME_SEARCH_TOO_SHORT,
} from '../../../domain/shared/error-codes.js';

/**
 * Paso 2: no vacío, máximo 40 caracteres y solo letras (con tildes y `ñ`), dígitos y guion, sin espacios
 * internos. Es la misma regla que revisa el DTO de C1.
 */
const SEARCH_FORMAT = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9-]{1,40}$/;

/** Paso 4: la referencia interna, sin distinguir mayúsculas. */
const RESERVATION_REF_PREFIX = /^RSV-/i;

const DIGIT = /\d/;

/** Paso 6: el mínimo de caracteres de una búsqueda por nombre. */
const MIN_NAME_LENGTH = 3;

/** Qué hacer si el código no coincide con ninguna reserva (paso 3). */
export type SearchFallback =
  | { kind: 'NOT_FOUND' }
  | { kind: 'DOCUMENT'; documentNumber: string }
  | { kind: 'NAME'; name: string };

/** El criterio de `search` (plan de `check-view-reservation`, "Algoritmo de búsqueda"; T006). */
export type SearchCriteria = {
  /** El texto normalizado (paso 1), para la coincidencia exacta del paso 3 sin distinguir mayúsculas. */
  code: string;
  /** Qué hacer si el paso 3 no encuentra nada. */
  fallback: SearchFallback;
};

/**
 * Convierte `search` en un criterio (plan de `check-view-reservation`, "Algoritmo de búsqueda"; T006). Hace
 * los pasos 1, 2, 4, 5 y 6 sin consultar la base; el paso 3 (buscar el código en paralelo) es de T015, que
 * aplica `fallback` si no encuentra nada:
 * 1. quita los espacios de los extremos;
 * 2. revisa el formato;
 * 4. si empieza con `RSV-`, sin coincidencia es `NOT_FOUND` (va antes que el 6: `RSV-ABC` no tiene dígitos);
 * 5. si tiene al menos un dígito, es un número de documento;
 * 6. si no, es un nombre, de al menos 3 caracteres.
 * Nunca da documento y nombre a la vez.
 * @throws BusinessError `INVALID_RESERVATION_CODE` (paso 2) o `NAME_SEARCH_TOO_SHORT` (paso 6).
 */
export function resolveSearchCriteria(search: string): SearchCriteria {
  const code = search.trim();
  if (!SEARCH_FORMAT.test(code)) {
    throw new BusinessError(
      INVALID_RESERVATION_CODE.code,
      INVALID_RESERVATION_CODE.message,
    );
  }
  if (RESERVATION_REF_PREFIX.test(code)) {
    return { code, fallback: { kind: 'NOT_FOUND' } };
  }
  if (DIGIT.test(code)) {
    return { code, fallback: { kind: 'DOCUMENT', documentNumber: code } };
  }
  if (code.length < MIN_NAME_LENGTH) {
    throw new BusinessError(
      NAME_SEARCH_TOO_SHORT.code,
      NAME_SEARCH_TOO_SHORT.message,
    );
  }
  return { code, fallback: { kind: 'NAME', name: code } };
}
