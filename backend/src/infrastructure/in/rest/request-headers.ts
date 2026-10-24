import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { ApiError } from '../../shared/api-error.js';
import { CLIENTS, isClient, type Client } from '../../shared/clients.js';

/** Lo que cabe en `processed_by` (plan base, tabla `cancellation` y `sire_export`). */
const MAX_USER_LENGTH = 100;

/**
 * El `X-Client` de la solicitud, si es uno de los que admite la ruta (plan base, regla 10).
 * @throws ApiError 400 `INVALID_CLIENT` si falta o no es uno de `allowed`.
 */
export function readClient(
  header: unknown,
  allowed: readonly Client[] = CLIENTS,
): Client {
  if (!isClient(header) || !allowed.includes(header)) {
    throw new ApiError(
      'INVALID_CLIENT',
      'La ruta no admite el cliente indicado en X-Client.',
    );
  }
  return header;
}

/**
 * El `X-User` de la solicitud, tal cual, para guardarlo en `processed_by`. No se comprueba quién es
 * (plan base, regla 10).
 * @throws ApiError 400 `USER_REQUIRED` si falta o está vacío, o `INVALID_USER` si no cabe en
 * `processed_by`.
 */
export function readUser(header: unknown): string {
  if (typeof header !== 'string' || header.trim() === '') {
    throw new ApiError('USER_REQUIRED', 'Falta el usuario que hace la acción.');
  }
  if (header.length > MAX_USER_LENGTH) {
    throw new ApiError(
      'INVALID_USER',
      'El usuario que hace la acción no es válido.',
    );
  }
  return header;
}

const headersOf = (context: ExecutionContext) =>
  context.switchToHttp().getRequest<Request>().headers;

/**
 * El llamador de la solicitud: `@ClientHeader(['RECEPTIONIST', 'MODULE1']) client: Client`. Sin
 * argumento, admite los tres.
 */
export const ClientHeader = createParamDecorator(
  (allowed: readonly Client[] | undefined, context: ExecutionContext) =>
    readClient(headersOf(context)['x-client'], allowed),
);

/** Quien hace la acción, para guardarlo: `@UserHeader() processedBy: string`. */
export const UserHeader = createParamDecorator(
  (_: unknown, context: ExecutionContext) =>
    readUser(headersOf(context)['x-user']),
);
