/** Cuerpo de todo error de la API (plan base, "Errores"). */
export interface ApiErrorBody {
  errorCode: string;
  message: string;
  timestamp: string;
  path: string;
}

/** Código de los errores de forma de la solicitud que no traen uno propio. */
export const INVALID_REQUEST = 'INVALID_REQUEST';
/** Código de todo error no controlado. */
export const UNEXPECTED_ERROR = 'UNEXPECTED_ERROR';

/**
 * Error de la API con su código HTTP. Lo usan los adaptadores de entrada (controladores y validación
 * de los DTO); los casos de uso lanzan `BusinessError`, que el filtro global traduce a un `ApiError`.
 *
 * El estado siempre es 4xx (400 por defecto): el diccionario prohíbe responder 5xx, 2xx o 3xx para un
 * error, y el filtro corrige a 400 cualquier otro valor.
 */
export class ApiError extends Error {
  constructor(
    readonly errorCode: string,
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
    this.name = new.target.name;
  }
}
