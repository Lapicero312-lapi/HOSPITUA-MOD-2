import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Options } from 'pino-http';
import { isClient } from './clients.js';

/** Cabecera con la que llega y sale el identificador de correlación (plan base, "Logs y correlación"). */
export const CORRELATION_HEADER = 'x-correlation-id';
const CORRELATION_ID_FORMAT = /^[\w-]{1,100}$/;

/** Lo que dejan en `response.locals` el interceptor del patrón de la ruta y el filtro global. */
type LogLocals = { routePattern?: string; errorCode?: string };
type RawResponse = ServerResponse & { locals?: LogLocals };

/** El `X-Correlation-Id` recibido si cumple `^[\w-]{1,100}$`; si no, un UUID nuevo. */
export function correlationIdFor(received: unknown): string {
  return typeof received === 'string' && CORRELATION_ID_FORMAT.test(received)
    ? received
    : randomUUID();
}

/** `X-Client` tal cual si es conocido, `INVALID` si es otro valor y `null` si no llegó. */
export function clientForLog(received: unknown): string | null {
  if (received === undefined) {
    return null;
  }
  return isClient(received) ? received : 'INVALID';
}

/**
 * El patrón de la ruta (`/api/reservations/:reservationRef`), nunca la ruta real: puede traer un
 * documento o una referencia. Lo guarda `RoutePatternInterceptor`; `null` si ningún controlador atendió
 * la solicitud.
 */
export function routePattern(res: RawResponse): string | null {
  return res.locals?.routePattern ?? null;
}

/**
 * Nivel del log de cada solicitud: `warn` si se respondió un error (los errores son siempre 4xx) y
 * `error` si algo falló sin respuesta. El detalle de un error no controlado lo escribe el filtro global.
 */
export function logLevelFor(
  statusCode: number,
  error?: Error,
): 'info' | 'warn' | 'error' {
  if (error || statusCode >= 500) {
    return 'error';
  }
  return statusCode >= 400 ? 'warn' : 'info';
}

/**
 * Opciones de `pino-http`: logs en JSON con el `correlationId` en cada línea escrita durante la
 * solicitud (nestjs-pino lo guarda con AsyncLocalStorage). De la solicitud solo se registran el método,
 * el patrón de la ruta y `X-Client`; nunca cabeceras, cuerpo ni consulta (no se escriben datos
 * personales en los logs).
 *
 * `req` se escribe al empezar la solicitud; `route` y `res`, al terminar, porque el patrón de la ruta y
 * el `errorCode` se conocen después.
 */
export function pinoHttpOptions(level: string): Options {
  return {
    level,
    genReqId: (req, res) => {
      const correlationId = correlationIdFor(req.headers[CORRELATION_HEADER]);
      res.setHeader(CORRELATION_HEADER, correlationId);
      return correlationId;
    },
    customAttributeKeys: { reqId: 'correlationId' },
    quietReqLogger: true,
    customLogLevel: (_req, res, error) => logLevelFor(res.statusCode, error),
    customSuccessMessage: () => 'Solicitud atendida',
    customErrorMessage: () => 'Solicitud con error',
    customSuccessObject: (_req, res, value) => ({
      ...value,
      route: routePattern(res),
    }),
    customErrorObject: (_req, res, _error, value) => ({
      ...value,
      route: routePattern(res),
    }),
    serializers: {
      req: (req: { raw: IncomingMessage }) => ({
        method: req.raw.method,
        client: clientForLog(req.raw.headers['x-client']),
      }),
      res: (res: { raw: RawResponse; statusCode: number }) => ({
        statusCode: res.statusCode,
        errorCode: res.raw.locals?.errorCode,
      }),
    },
  };
}
