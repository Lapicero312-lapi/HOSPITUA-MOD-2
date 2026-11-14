import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { lastValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import {
  CONCURRENCY_RETRY_AFTER_SECONDS,
  type SireAdmission,
  SireRateLimiter,
  SireRequestLimits,
  sireRequestLimitsProvider,
} from '../../../../../src/infrastructure/in/rest/sire-rate-limiter.js';

/** Los valores por defecto del plan: 10 por minuto por usuario y 3 simultáneas. */
const LIMITS = { perMinute: 10, maxConcurrent: 3 };

/** Admite `count` solicitudes de `user`, una por segundo desde `from`, y libera cada una. */
function admitMany(
  limits: SireRequestLimits,
  user: string,
  count: number,
  from = 0,
): void {
  for (let i = 0; i < count; i += 1) {
    const admission = limits.admit(user, from + i * 1_000);
    expect(admission.admitted).toBe(true);
    if (admission.admitted) {
      admission.release();
    }
  }
}

function retryAfter(admission: SireAdmission): number | null {
  return admission.admitted ? null : admission.retryAfterSeconds;
}

describe('SireRequestLimits (plan de export-sire-file, punto 13)', () => {
  describe('por usuario: una ventana móvil de 60 s', () => {
    it('admite 10 en la ventana y rechaza la 11, con lo que falta para que salga la más vieja', () => {
      const limits = new SireRequestLimits(LIMITS);
      admitMany(limits, 'ana', 10);

      // La más vieja entró en 0: sale de la ventana en 60 000; desde 9 500 faltan 50,5 s → 51.
      expect(retryAfter(limits.admit('ana', 9_500))).toBe(51);
    });

    it('a los 60 s exactos la más vieja ya salió; a los 59 999 ms todavía no', () => {
      const limits = new SireRequestLimits(LIMITS);
      admitMany(limits, 'ana', 10);

      expect(retryAfter(limits.admit('ana', 59_999))).toBe(1);
      expect(limits.admit('ana', 60_000).admitted).toBe(true);
    });

    it('una solicitud rechazada no cuenta: no alarga la espera', () => {
      const limits = new SireRequestLimits(LIMITS);
      admitMany(limits, 'ana', 10);
      for (let at = 9_100; at < 60_000; at += 5_000) {
        expect(limits.admit('ana', at).admitted).toBe(false);
      }

      expect(limits.admit('ana', 60_000).admitted).toBe(true);
    });

    it('cada usuario tiene su propia ventana', () => {
      const limits = new SireRequestLimits(LIMITS);
      admitMany(limits, 'ana', 10);

      expect(limits.admit('luis', 9_500).admitted).toBe(true);
    });

    it('con un límite de 1, la segunda en el mismo minuto espera los 60 s', () => {
      const limits = new SireRequestLimits({ perMinute: 1, maxConcurrent: 3 });
      admitMany(limits, 'ana', 1);

      expect(retryAfter(limits.admit('ana', 0))).toBe(60);
    });
  });

  describe('de concurrencia: 3 simultáneas entre todos los usuarios', () => {
    it('la cuarta a la vez se rechaza con Retry-After de 2 s, aunque sea de otro usuario', () => {
      const limits = new SireRequestLimits(LIMITS);
      limits.admit('ana', 0);
      limits.admit('ana', 0);
      limits.admit('luis', 0);

      expect(retryAfter(limits.admit('marta', 0))).toBe(
        CONCURRENCY_RETRY_AFTER_SECONDS,
      );
      expect(CONCURRENCY_RETRY_AFTER_SECONDS).toBe(2);
    });

    it('al terminar una exportación se libera su cupo', () => {
      const limits = new SireRequestLimits(LIMITS);
      const first = limits.admit('ana', 0);
      limits.admit('ana', 0);
      limits.admit('ana', 0);
      if (first.admitted) {
        first.release();
      }

      expect(limits.admit('luis', 0).admitted).toBe(true);
    });

    it('liberar dos veces la misma no libera dos cupos', () => {
      const limits = new SireRequestLimits({ perMinute: 10, maxConcurrent: 2 });
      const first = limits.admit('ana', 0);
      limits.admit('ana', 0);
      if (first.admitted) {
        first.release();
        first.release();
      }

      expect(limits.admit('luis', 0).admitted).toBe(true);
      expect(limits.admit('marta', 0).admitted).toBe(false);
    });

    it('una rechazada por concurrencia no cuenta en la ventana del usuario', () => {
      const limits = new SireRequestLimits({ perMinute: 2, maxConcurrent: 1 });
      const running = limits.admit('luis', 0);
      expect(limits.admit('ana', 0).admitted).toBe(false);
      if (running.admitted) {
        running.release();
      }

      admitMany(limits, 'ana', 2, 1_000);
    });
  });

  it('el límite por usuario se revisa antes que el de concurrencia', () => {
    const limits = new SireRequestLimits({ perMinute: 1, maxConcurrent: 1 });
    limits.admit('ana', 0);

    // Las dos se superan: el Retry-After es el de la ventana (60), no el de concurrencia (2).
    expect(retryAfter(limits.admit('ana', 0))).toBe(60);
  });
});

/** Un contexto HTTP con la cabecera `X-User` pedida y una respuesta que guarda sus cabeceras. */
function httpContext(user: string | undefined) {
  const headers: Record<string, string> = {};
  const context = {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: user === undefined ? {} : { 'x-user': user },
      }),
      getResponse: () => ({
        setHeader: (name: string, value: string) => {
          headers[name] = value;
        },
      }),
    }),
  } as unknown as ExecutionContext;
  return { context, headers };
}

describe('SireRateLimiter', () => {
  it('admite la solicitud y libera el cupo cuando la exportación termina bien', async () => {
    const limits = new SireRequestLimits({ perMinute: 10, maxConcurrent: 1 });
    const limiter = new SireRateLimiter(limits, () => 0);
    const handle = vi.fn(() => of('archivo'));

    await expect(
      lastValueFrom(
        limiter.intercept(httpContext('Ana').context, {
          handle,
        } as CallHandler),
      ),
    ).resolves.toBe('archivo');

    expect(handle).toHaveBeenCalledTimes(1);
    expect(limits.admit('Luis', 0).admitted).toBe(true);
  });

  it('libera el cupo también si la exportación falla', async () => {
    const limits = new SireRequestLimits({ perMinute: 10, maxConcurrent: 1 });
    const limiter = new SireRateLimiter(limits, () => 0);
    const failure = new Error('INVALID_GUEST_CHARACTERS');

    await expect(
      lastValueFrom(
        limiter.intercept(httpContext('Ana').context, {
          handle: () => throwError(() => failure),
        }),
      ),
    ).rejects.toBe(failure);

    expect(limits.admit('Luis', 0).admitted).toBe(true);
  });

  it('con el límite superado responde 429 TOO_MANY_REQUESTS con Retry-After, sin llegar a la exportación', () => {
    const limits = new SireRequestLimits({ perMinute: 1, maxConcurrent: 3 });
    limits.admit('Ana', 0);
    const limiter = new SireRateLimiter(limits, () => 30_000);
    const handle = vi.fn(() => of('archivo'));
    const { context, headers } = httpContext('Ana');

    expect(() => limiter.intercept(context, { handle })).toThrow(
      expect.objectContaining({
        errorCode: 'TOO_MANY_REQUESTS',
        message:
          'Se superó el límite de solicitudes de exportación. Intente de nuevo en unos segundos.',
        status: 429,
      }),
    );
    expect(headers).toEqual({ 'Retry-After': '30' });
    expect(handle).not.toHaveBeenCalled();
  });

  it('sin X-User responde USER_REQUIRED antes de revisar los límites', () => {
    const limits = new SireRequestLimits({ perMinute: 1, maxConcurrent: 1 });
    const limiter = new SireRateLimiter(limits, () => 0);

    expect(() =>
      limiter.intercept(httpContext(undefined).context, {
        handle: () => of('archivo'),
      }),
    ).toThrow(expect.objectContaining({ errorCode: 'USER_REQUIRED' }));
    expect(limits.admit('Ana', 0).admitted).toBe(true);
  });

  it('sireRequestLimitsProvider toma los límites de SIRE_RATE_LIMIT_PER_MINUTE y SIRE_MAX_CONCURRENT', () => {
    const values: Record<string, number> = {
      SIRE_RATE_LIMIT_PER_MINUTE: 1,
      SIRE_MAX_CONCURRENT: 2,
    };
    const config = {
      get: (key: string) => values[key],
    } as unknown as ConfigService;
    const factory = (
      sireRequestLimitsProvider as {
        useFactory: (config: ConfigService) => SireRequestLimits;
      }
    ).useFactory;
    const limits = factory(config);

    // 1 por minuto: la segunda de Ana espera la ventana.
    expect(limits.admit('Ana', 0).admitted).toBe(true);
    expect(retryAfter(limits.admit('Ana', 0))).toBe(60);
    // 2 simultáneas: la de Luis entra (la de Ana sigue en curso) y la de Marta no.
    expect(limits.admit('Luis', 0).admitted).toBe(true);
    expect(retryAfter(limits.admit('Marta', 0))).toBe(2);
  });
});
