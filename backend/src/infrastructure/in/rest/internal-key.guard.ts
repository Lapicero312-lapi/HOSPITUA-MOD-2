import { createHash, timingSafeEqual } from 'node:crypto';
import {
  applyDecorators,
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiSecurity, ApiUnauthorizedResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { ApiError, ApiErrorBody } from '../../shared/api-error.js';
import type { Client } from '../../shared/clients.js';
import { errorExample } from './openapi-examples.js';

/**
 * La clave que el Módulo 2 exige a los Módulos 1 y 3 en `X-Internal-Key` (`MODULE2_INTERNAL_KEY`, plan base,
 * "Configuración del Módulo 2"). `null`: no se exige.
 */
export const MODULE2_INTERNAL_KEY = Symbol('MODULE2_INTERNAL_KEY');

/** El esquema de seguridad en OpenAPI (`configureApp`): se llama como la cabecera que lleva la clave. */
export const INTERNAL_KEY_SECURITY = 'X-Internal-Key';

export const INVALID_INTERNAL_KEY = {
  code: 'INVALID_INTERNAL_KEY',
  message: 'Falta la clave interna o no es válida.',
} as const;

const REQUIRES_INTERNAL_KEY = 'm2:requiresInternalKey';

/** A quién se le exige la clave en una ruta: a todos (`null`) o solo a esos valores de `X-Client`. */
type InternalKeyRule = { clients: readonly Client[] | null };

/**
 * La ruta la usan otros módulos y exige `X-Internal-Key` cuando hay clave configurada. Sin `clients`, a todo
 * el que llama (rutas de un solo llamador, como las de comisiones). Con `clients`, solo cuando `X-Client` es
 * uno de ellos: la Recepcionista usa la misma ruta desde el navegador, que no puede guardar un secreto.
 */
export function RequiresInternalKey(
  clients: readonly Client[] | null = null,
): MethodDecorator {
  const who =
    clients === null
      ? 'Con clave configurada'
      : `Con \`X-Client: ${clients.join('` o `')}\` y clave configurada`;
  return applyDecorators(
    SetMetadata(REQUIRES_INTERNAL_KEY, {
      clients,
    } satisfies InternalKeyRule),
    ApiSecurity(INTERNAL_KEY_SECURITY),
    ApiUnauthorizedResponse({
      type: ApiErrorBody,
      description: `${who}: falta \`X-Internal-Key\` o no coincide.`,
      examples: {
        [INVALID_INTERNAL_KEY.code]: errorExample(
          '/api/…',
          'Sin X-Internal-Key o con otra clave',
          INVALID_INTERNAL_KEY.code,
          INVALID_INTERNAL_KEY.message,
        ),
      },
    }),
  );
}

/** El resumen de la clave, del mismo largo siempre, para compararlo en tiempo constante. */
const digest = (value: string) => createHash('sha256').update(value).digest();

/**
 * Exige `X-Internal-Key` en las rutas marcadas con `@RequiresInternalKey` (plan base, regla 10). Sin clave
 * configurada no exige nada. La clave nunca se escribe en los logs ni en la respuesta.
 * @throws ApiError 401 `INVALID_INTERNAL_KEY` si falta o no coincide.
 */
@Injectable()
export class InternalKeyGuard implements CanActivate {
  private readonly expected: Buffer | null;

  constructor(
    private readonly reflector: Reflector,
    @Inject(MODULE2_INTERNAL_KEY) internalKey: string | null,
  ) {
    this.expected = internalKey ? digest(internalKey) : null;
  }

  canActivate(context: ExecutionContext): boolean {
    if (this.expected === null || context.getType() !== 'http') {
      return true;
    }
    const rule = this.reflector.get<InternalKeyRule | undefined>(
      REQUIRES_INTERNAL_KEY,
      context.getHandler(),
    );
    if (rule === undefined) {
      return true;
    }
    const { headers } = context.switchToHttp().getRequest<Request>();
    if (
      rule.clients !== null &&
      !rule.clients.some((client) => client === headers['x-client'])
    ) {
      return true;
    }
    const given = headers['x-internal-key'];
    if (
      typeof given !== 'string' ||
      !timingSafeEqual(digest(given), this.expected)
    ) {
      throw new ApiError(
        INVALID_INTERNAL_KEY.code,
        INVALID_INTERNAL_KEY.message,
        401,
      );
    }
    return true;
  }
}
