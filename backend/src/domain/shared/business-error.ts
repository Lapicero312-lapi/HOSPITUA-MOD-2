/**
 * Una regla de negocio no se cumple. Cada caso de uso declara sus códigos y los mensajes literales de
 * su plan, por ejemplo `new BusinessError('NO_AVAILABILITY', '...')`.
 *
 * El dominio no conoce HTTP: el filtro global de `infrastructure/shared` lo responde como 400.
 */
export class BusinessError extends Error {
  constructor(
    readonly errorCode: string,
    message: string,
  ) {
    super(message);
  }
}
