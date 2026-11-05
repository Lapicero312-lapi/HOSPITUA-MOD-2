import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  NestInterceptor,
  Optional,
  type Provider,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { finalize, type Observable } from 'rxjs';
import { TOO_MANY_REQUESTS } from '../../../application/use-cases/export-sire-file/error-codes.js';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { ApiError } from '../../shared/api-error.js';
import { readUser } from './request-headers.js';

/** Símbolo con el que Nest inyecta los límites (`SireRequestLimits`) en el limitador. */
export const SIRE_REQUEST_LIMITS = Symbol('SIRE_REQUEST_LIMITS');

/** Solo para las pruebas: la hora (ms) con la que el limitador cuenta. Sin ella, `Date.now`. */
export const SIRE_RATE_LIMITER_NOW = Symbol('SIRE_RATE_LIMITER_NOW');

/** La ventana móvil del límite por usuario (plan de `export-sire-file`, punto 13). */
export const WINDOW_MS = 60_000;

/** `Retry-After` cuando el límite es el de concurrencia: una exportación tarda menos de 2 s (NFR-001). */
export const CONCURRENCY_RETRY_AFTER_SECONDS = 2;

/** `SIRE_RATE_LIMIT_PER_MINUTE` y `SIRE_MAX_CONCURRENT`, de la configuración validada (mínimo 1). */
export type SireRateLimits = { perMinute: number; maxConcurrent: number };

/** Si la solicitud pasa: con qué liberar su cupo simultáneo, o cuántos segundos esperar. */
export type SireAdmission =
  | { admitted: true; release: () => void }
  | { admitted: false; retryAfterSeconds: number };

/**
 * Los dos límites de las exportaciones SIRE, en la memoria del proceso (plan, punto 6; puntos abiertos,
 * 2): por usuario, una ventana móvil de 60 s, y de concurrencia, para no agotar la memoria con archivos
 * armados a la vez (regla 10). No conoce HTTP: lo usa `SireRateLimiter`.
 */
export class SireRequestLimits {
  /** Las horas (ms) de las solicitudes admitidas de cada usuario dentro de la ventana. */
  private readonly admittedAt = new Map<string, number[]>();
  private running = 0;

  constructor(private readonly limits: SireRateLimits) {}

  /** Primero el límite por usuario y después el de concurrencia; una solicitud rechazada no cuenta. */
  admit(user: string, now: number): SireAdmission {
    const inWindow = (this.admittedAt.get(user) ?? []).filter(
      (at) => now - at < WINDOW_MS,
    );
    const oldest = inWindow[0];
    if (oldest !== undefined && inWindow.length >= this.limits.perMinute) {
      this.admittedAt.set(user, inWindow);
      return {
        admitted: false,
        retryAfterSeconds: Math.ceil((oldest + WINDOW_MS - now) / 1_000),
      };
    }
    if (this.running >= this.limits.maxConcurrent) {
      this.admittedAt.set(user, inWindow);
      return {
        admitted: false,
        retryAfterSeconds: CONCURRENCY_RETRY_AFTER_SECONDS,
      };
    }
    this.admittedAt.set(user, [...inWindow, now]);
    this.running += 1;
    let released = false;
    return {
      admitted: true,
      release: () => {
        if (!released) {
          released = true;
          this.running -= 1;
        }
      },
    };
  }
}

/**
 * El límite de `POST /api/sire/exports` (plan de `export-sire-file`, punto 13). Revisa `X-User`
 * (`USER_REQUIRED` o `INVALID_USER`), y si se supera un límite responde **429** `TOO_MANY_REQUESTS` con
 * la cabecera `Retry-After`, sin llegar a la exportación ni a la base de datos. El cupo simultáneo se
 * libera cuando la exportación termina, bien o con error.
 */
@Injectable()
export class SireRateLimiter implements NestInterceptor {
  private readonly now: () => number;

  constructor(
    @Inject(SIRE_REQUEST_LIMITS)
    private readonly limits: SireRequestLimits,
    @Optional() @Inject(SIRE_RATE_LIMITER_NOW) now?: () => number,
  ) {
    this.now = now ?? Date.now;
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const user = readUser(http.getRequest<Request>().headers['x-user']);
    const admission = this.limits.admit(user, this.now());
    if (!admission.admitted) {
      http
        .getResponse<Response>()
        .setHeader('Retry-After', String(admission.retryAfterSeconds));
      throw new ApiError(
        TOO_MANY_REQUESTS.code,
        TOO_MANY_REQUESTS.message,
        429,
      );
    }
    return next.handle().pipe(finalize(admission.release));
  }
}

/**
 * Los límites de las exportaciones, con los valores de la configuración validada. Lo registra el módulo del
 * controlador de SIRE (T008), que aplica el limitador con `@UseInterceptors(SireRateLimiter)`: Nest crea
 * el interceptor por su cuenta e inyecta estos límites, una sola instancia con la cuenta de todos.
 */
export const sireRequestLimitsProvider: Provider = {
  provide: SIRE_REQUEST_LIMITS,
  inject: [ConfigService],
  useFactory: (config: ConfigService<EnvironmentVariables, true>) =>
    new SireRequestLimits({
      perMinute: config.get('SIRE_RATE_LIMIT_PER_MINUTE', { infer: true }),
      maxConcurrent: config.get('SIRE_MAX_CONCURRENT', { infer: true }),
    }),
};
