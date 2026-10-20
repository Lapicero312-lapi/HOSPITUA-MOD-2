import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  BusinessError,
  NotFoundError,
} from '../../domain/shared/business-error.js';
import {
  ApiError,
  ApiErrorBody,
  INVALID_REQUEST,
  INVALID_REQUEST_MESSAGE,
  REQUEST_NOT_PROCESSED,
  REQUEST_NOT_PROCESSED_MESSAGE,
} from './api-error.js';

/** Mensajes de los errores de forma que genera el servidor (ruta inexistente, cuerpo muy grande...). */
const REQUEST_ERROR_MESSAGES: Record<number, string> = {
  404: 'La ruta solicitada no existe.',
  413: 'La solicitud supera el tamaño permitido.',
  415: 'El tipo de contenido de la solicitud no es compatible.',
};

/**
 * Filtro global: toda excepción de una solicitud HTTP sale como un `ApiError` 4xx con el cuerpo
 * `{ errorCode, message, timestamp, path }`.
 * - `ApiError`: su código, mensaje y estado; con `retryAfterSeconds`, la cabecera `Retry-After`.
 * - `BusinessError` (casos de uso): 400; `NotFoundError`, 404.
 * - Errores 4xx del servidor o de Nest (ruta inexistente, JSON mal formado, cuerpo muy grande): su
 *   estado, con `INVALID_REQUEST` y un mensaje en español. Una validación de Nest con varios mensajes
 *   responde el primero.
 * - Cualquier otro error, también los 5xx: 400 `REQUEST_NOT_PROCESSED`; el detalle solo va al log.
 *
 * Fuera de HTTP (consumidores de RabbitMQ) no responde nada: vuelve a lanzar la excepción para que
 * la mensajería aplique sus reintentos y su dead-letter.
 */
@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') {
      throw exception;
    }

    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    if (response.headersSent) {
      // La respuesta ya empezó a enviarse (por ejemplo, una descarga): solo se puede cerrar.
      this.logger.error(
        'Error después de empezar a enviar la respuesta',
        this.stackOf(exception),
      );
      response.end();
      return;
    }

    const error = this.toApiError(exception);
    const body: ApiErrorBody = {
      errorCode: error.errorCode,
      message: error.message,
      timestamp: new Date().toISOString(),
      // Solo la ruta: la consulta (`?search=...`) puede llevar documentos o nombres.
      path: request.path,
    };
    if (error.retryAfterSeconds !== undefined) {
      response.setHeader('Retry-After', String(error.retryAfterSeconds));
    }
    response.status(error.status).json(body);
  }

  private toApiError(exception: unknown): ApiError {
    if (exception instanceof ApiError) {
      if (isClientError(exception.status)) return exception;
      this.logger.warn(
        `ApiError ${exception.errorCode} con estado ${exception.status}: se responde 400`,
      );
      return new ApiError(exception.errorCode, exception.message);
    }

    if (exception instanceof BusinessError) {
      const status = exception instanceof NotFoundError ? 404 : 400;
      return new ApiError(exception.errorCode, exception.message, status);
    }

    const requestError = this.requestErrorOf(exception);
    if (requestError) return requestError;

    this.logger.error(
      exception instanceof Error ? exception.message : 'Error no controlado',
      this.stackOf(exception),
    );
    return new ApiError(REQUEST_NOT_PROCESSED, REQUEST_NOT_PROCESSED_MESSAGE);
  }

  /**
   * Errores 4xx que no lanzó el Módulo 2: excepciones de Nest y errores del lector del cuerpo
   * (`body-parser`), que traen `status` y `expose`. Su texto original está en inglés y puede describir
   * la implementación, así que se responde un mensaje propio.
   */
  private requestErrorOf(exception: unknown): ApiError | undefined {
    let status: number | undefined;
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const validationMessage = firstValidationMessage(exception);
      if (isClientError(status) && validationMessage) {
        return new ApiError(INVALID_REQUEST, validationMessage, status);
      }
    } else if (isExposedHttpError(exception)) {
      status = exception.status;
    }

    if (status === undefined || !isClientError(status)) return undefined;
    return new ApiError(
      INVALID_REQUEST,
      REQUEST_ERROR_MESSAGES[status] ?? INVALID_REQUEST_MESSAGE,
      status,
    );
  }

  private stackOf(exception: unknown): string | undefined {
    return exception instanceof Error ? exception.stack : undefined;
  }
}

function isClientError(status: number): boolean {
  return Number.isInteger(status) && status >= 400 && status < 500;
}

/** Errores de `http-errors` (los usa `body-parser`): `{ status, expose: true }`. */
function isExposedHttpError(
  exception: unknown,
): exception is { status: number; expose: true } {
  if (typeof exception !== 'object' || exception === null) return false;
  const candidate = exception as { status?: unknown; expose?: unknown };
  return typeof candidate.status === 'number' && candidate.expose === true;
}

/** Primer mensaje de una validación de Nest (`ValidationPipe` sin `exceptionFactory`): una lista. */
function firstValidationMessage(exception: HttpException): string | undefined {
  const response = exception.getResponse();
  if (typeof response !== 'object' || response === null) return undefined;
  const message = (response as { message?: unknown }).message;
  if (!Array.isArray(message)) return undefined;
  const [first] = message as unknown[];
  return typeof first === 'string' ? first : undefined;
}
