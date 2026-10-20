/**
 * Una regla de negocio no se cumple. Cada caso de uso declara sus códigos y los mensajes literales de
 * su plan, por ejemplo `new BusinessError('NO_AVAILABILITY', '...')`.
 *
 * El dominio no conoce HTTP: el filtro global de `infrastructure/shared` responde 400.
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

export const CONCURRENT_UPDATE = 'CONCURRENT_UPDATE';

/**
 * Otra edición o cancelación cambió la reserva antes (su `updatedAt` ya no coincide). Siempre es
 * 400 `CONCURRENT_UPDATE` (plan base, regla transversal 5), con el mismo mensaje en
 * `update-reservation` y `cancel-reservation`.
 */
export class ConcurrentUpdateError extends BusinessError {
  constructor() {
    super(
      CONCURRENT_UPDATE,
      'Esta reserva ya fue actualizada o cancelada recientemente',
    );
  }
}
