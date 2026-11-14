import type { ApiErrorBody } from '../../shared/api-error.js';

/** Un ejemplo de error para OpenAPI: su resumen y el cuerpo que responde el filtro global. */
export function errorExample(
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
      timestamp: '2026-10-09T14:14:00.000Z',
      path,
    } satisfies ApiErrorBody,
  };
}

/**
 * `INVALID_CLIENT`, el primer error de toda ruta que lee `X-Client`: la cabecera se lee antes que todo (plan
 * base, regla transversal 10).
 */
export const INVALID_CLIENT_EXAMPLE = (path: string) =>
  errorExample(
    path,
    'Sin `X-Client`, o con un llamador que la ruta no admite',
    'INVALID_CLIENT',
    'La ruta no admite el cliente indicado en X-Client.',
  );
