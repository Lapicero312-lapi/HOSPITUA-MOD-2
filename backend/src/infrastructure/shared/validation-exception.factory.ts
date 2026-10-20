import type { ValidationError } from 'class-validator';
import {
  ApiError,
  INVALID_REQUEST,
  INVALID_REQUEST_MESSAGE,
} from './api-error.js';

/** Contexto que un DTO pone en sus decoradores para fijar el código de error del spec. */
export interface ValidationErrorContext {
  errorCode?: string;
}

/**
 * Convierte los errores de `class-validator` en un `ApiError` 400 con el **primer** error, como piden
 * los planes ("el primero que falle responde"):
 * - entre propiedades, en el orden en que el DTO las declara (también dentro de objetos anidados);
 * - dentro de una propiedad, el decorador escrito **más arriba**. `class-validator` los informa al
 *   revés (de abajo hacia arriba), por eso se toma el último.
 *
 * El código sale del `context` del decorador y el mensaje es el `message` del decorador, que debe ser
 * el literal del spec:
 *
 * ```ts
 * @Matches(DATE_PATTERN, {
 *   message: 'La fecha de llegada no es válida',
 *   context: { errorCode: 'INVALID_STAY_DATES' },
 * })
 * startDate: string;
 * ```
 *
 * Sin `context.errorCode`, el código es `INVALID_REQUEST`.
 */
export function validationExceptionFactory(
  errors: ValidationError[],
): ApiError {
  const first = findFirstConstraint(errors);
  if (!first) {
    return new ApiError(INVALID_REQUEST, INVALID_REQUEST_MESSAGE);
  }
  return new ApiError(first.errorCode ?? INVALID_REQUEST, first.message);
}

function findFirstConstraint(
  errors: ValidationError[],
): { message: string; errorCode?: string } | undefined {
  for (const error of errors) {
    const [name, message] =
      Object.entries(error.constraints ?? {}).at(-1) ?? [];
    if (name !== undefined && message !== undefined) {
      const context = error.contexts?.[name] as
        ValidationErrorContext | undefined;
      return { message, errorCode: context?.errorCode };
    }
    const nested = findFirstConstraint(error.children ?? []);
    if (nested) return nested;
  }
  return undefined;
}
