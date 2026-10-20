/**
 * Una regla de negocio no se cumple. Cada caso de uso declara sus códigos y los mensajes literales de
 * su spec, por ejemplo `new BusinessError('NO_AVAILABILITY', '...')`.
 *
 * El dominio no conoce HTTP: el filtro global de `infrastructure/shared` decide el código de estado
 * (400 por defecto).
 */
export class BusinessError extends Error {
  constructor(
    readonly errorCode: string,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * El recurso no existe y el contrato pide distinguirlo (HTTP 404). Solo la consulta de una reserva
 * por referencia que hace el Módulo 3; en el resto de casos "no existe" es un `BusinessError` (400).
 */
export class NotFoundError extends BusinessError {}

/** Se superó el límite de solicitudes permitido (HTTP 429), como en la exportación SIRE. */
export class TooManyRequestsError extends BusinessError {}
