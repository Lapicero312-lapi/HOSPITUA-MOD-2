/** Cuerpo de todo error de la API (plan base, "Errores"). */
export interface ApiErrorBody {
  errorCode: string;
  message: string;
  timestamp: string;
  path: string;
}

/** Código y mensaje de toda excepción inesperada (planes de los casos de uso). */
export const REQUEST_NOT_PROCESSED = 'REQUEST_NOT_PROCESSED';
export const REQUEST_NOT_PROCESSED_MESSAGE =
  'No fue posible procesar la solicitud.';

/**
 * Error de la API con su código HTTP (400 por defecto). El diccionario prohíbe responder 5xx, 2xx o 3xx
 * para un error: si llega con un estado que no es 4xx, el filtro global responde 400. Lo lanzan los
 * adaptadores de entrada; los casos de uso lanzan `BusinessError`, que el filtro global traduce a un
 * `ApiError`.
 */
export class ApiError extends Error {
  constructor(
    readonly errorCode: string,
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
  }
}
