/**
 * Error controlado del Módulo 2. Todo error que sale por la API es un `ApiError` con un código de
 * la familia HTTP 4xx (400 por defecto): el diccionario prohíbe responder 500.
 *
 * Es TypeScript puro para poder usarse desde el dominio y los casos de uso; el filtro global de
 * `infrastructure/shared` lo convierte en la respuesta HTTP.
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

/** Una regla de negocio no se cumple (HTTP 400). Cada caso de uso declara sus códigos y mensajes. */
export class BusinessError extends ApiError {
  constructor(errorCode: string, message: string) {
    super(errorCode, message, 400);
  }
}

/**
 * El recurso no existe (HTTP 404). Solo se usa donde el contrato lo exige, como la consulta de una
 * reserva por referencia que hace el Módulo 3; en el resto de casos "no existe" es un 400.
 */
export class NotFoundError extends ApiError {
  constructor(errorCode: string, message: string) {
    super(errorCode, message, 404);
  }
}

/** Se superó el límite de solicitudes permitido (HTTP 429), como en la exportación SIRE. */
export class TooManyRequestsError extends ApiError {
  constructor(errorCode: string, message: string) {
    super(errorCode, message, 429);
  }
}
