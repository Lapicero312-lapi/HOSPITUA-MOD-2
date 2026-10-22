import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { BusinessError } from '../../domain/shared/business-error.js';
import {
  ApiError,
  ApiErrorBody,
  REQUEST_NOT_PROCESSED,
  REQUEST_NOT_PROCESSED_MESSAGE,
} from './api-error.js';

/**
 * Filtro global (plan base, regla transversal 5): traduce toda excepción a un `ApiError` 4xx con el
 * cuerpo `{ errorCode, message, timestamp, path }`; nunca responde 500.
 * - `ApiError`: su código, su mensaje y su estado (si no es 4xx, 400).
 * - `BusinessError`: 400 con su código y su mensaje.
 * - Error de la solicitud (un 4xx de Nest: ruta inexistente, JSON mal formado...): 400
 *   `REQUEST_NOT_PROCESSED`.
 * - Cualquier otra excepción (no controlada): registra el detalle con nivel `error` (si no es un
 *   `Error`, solo su tipo) y responde 400 `REQUEST_NOT_PROCESSED`, sin datos de infraestructura.
 *
 * Los errores controlados (los tres primeros) no se registran aquí: los registra el log de la solicitud
 * con nivel `warn` y el `errorCode`, que el filtro deja en `response.locals` (plan base, "Logs y
 * correlación").
 */
@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const error = this.toApiError(exception);
    const body: ApiErrorBody = {
      errorCode: error.errorCode,
      message: error.message,
      timestamp: new Date().toISOString(),
      path: pathWithoutQuery(request),
    };
    response.locals.errorCode = error.errorCode;
    response.status(error.status).json(body);
  }

  private toApiError(exception: unknown): ApiError {
    if (exception instanceof ApiError) {
      return isClientError(exception.status)
        ? exception
        : new ApiError(exception.errorCode, exception.message);
    }

    if (exception instanceof BusinessError) {
      return new ApiError(exception.errorCode, exception.message);
    }

    // Su mensaje no se registra: el de una ruta inexistente trae la URL, con la consulta.
    if (
      exception instanceof HttpException &&
      isClientError(exception.getStatus())
    ) {
      return new ApiError(REQUEST_NOT_PROCESSED, REQUEST_NOT_PROCESSED_MESSAGE);
    }

    if (exception instanceof Error) {
      this.logger.error(exception.message, exception.stack);
    } else {
      // Solo el tipo: el valor puede traer datos personales, que nunca van al log (plan base).
      this.logger.error(nonErrorDescription(exception));
    }
    return new ApiError(REQUEST_NOT_PROCESSED, REQUEST_NOT_PROCESSED_MESSAGE);
  }
}

/**
 * La ruta completa, con el prefijo `/api` y sin la consulta. No se usa `request.path`: en una ruta que no
 * existe, Express la entrega sin el prefijo.
 */
function pathWithoutQuery(request: Request): string {
  return request.originalUrl.split('?')[0];
}

function nonErrorDescription(exception: unknown): string {
  const type = exception === null ? 'null' : typeof exception;
  return `Se lanzó un valor que no es un Error (tipo: ${type})`;
}

function isClientError(status: number): boolean {
  return Number.isInteger(status) && status >= 400 && status < 500;
}
