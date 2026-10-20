import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiError } from '../../domain/shared/api-error.js';

/** Cuerpo de todo error de la API (plan base, "Errores"). */
export interface ErrorResponseBody {
  errorCode: string;
  message: string;
  timestamp: string;
  path: string;
}

export const INVALID_REQUEST = 'INVALID_REQUEST';
export const UNEXPECTED_ERROR = 'UNEXPECTED_ERROR';
export const UNEXPECTED_ERROR_MESSAGE =
  'No fue posible procesar la solicitud. Intente de nuevo.';

/** Código HTTP 4xx usado por defecto: la API nunca responde 5xx. */
const DEFAULT_STATUS = 400;

/**
 * Filtro global: traduce toda excepción a un `ApiError` 4xx.
 * - `ApiError`: se responde con su código, mensaje y estado.
 * - Excepciones de Nest 4xx (cuerpo mal formado, ruta inexistente...): se conserva el estado.
 * - Todo lo demás (incluidos los 5xx): se registra el detalle en el log y se responde un error
 *   controlado 400, sin datos de infraestructura.
 */
@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const { status, errorCode, message } = this.translate(exception);

    const body: ErrorResponseBody = {
      errorCode,
      message,
      timestamp: new Date().toISOString(),
      // Solo la ruta: la consulta (`?search=...`) puede llevar documentos o nombres.
      path: request.path,
    };
    response.status(status).json(body);
  }

  private translate(exception: unknown): {
    status: number;
    errorCode: string;
    message: string;
  } {
    if (exception instanceof ApiError) {
      return {
        status: exception.status,
        errorCode: exception.errorCode,
        message: exception.message,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (status >= 400 && status < 500) {
        return {
          status,
          errorCode: INVALID_REQUEST,
          message: this.messageOf(exception),
        };
      }
    }

    // Detalle solo en el log (con la traza); nunca en la respuesta.
    this.logger.error(
      exception instanceof Error ? exception.message : 'Error no controlado',
      exception instanceof Error ? exception.stack : undefined,
    );
    return {
      status: DEFAULT_STATUS,
      errorCode: UNEXPECTED_ERROR,
      message: UNEXPECTED_ERROR_MESSAGE,
    };
  }

  /** Mensaje de una excepción de Nest: el primero cuando la validación devuelve una lista. */
  private messageOf(exception: HttpException): string {
    const response = exception.getResponse();
    if (typeof response === 'string') return response;
    const message = (response as { message?: string | string[] }).message;
    if (Array.isArray(message)) return message[0] ?? exception.message;
    return message ?? exception.message;
  }
}
