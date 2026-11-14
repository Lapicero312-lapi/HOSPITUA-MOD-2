import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Observable } from 'rxjs';

/**
 * Guarda en `response.locals.routePattern` el patrón de la ruta que atiende la solicitud
 * (`/api/reservations/:reservationRef`), para el log de la solicitud. Se toma aquí, cuando la solicitud
 * llega al controlador: al terminar la respuesta, Express ya no conserva la ruta del controlador. Si
 * ningún controlador la atiende (ruta inexistente), el log no tiene patrón.
 */
@Injectable()
export class RoutePatternInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() === 'http') {
      const http = context.switchToHttp();
      const request = http.getRequest<Request>();
      const response = http.getResponse<Response>();
      if (request.route) {
        response.locals.routePattern = `${request.baseUrl}${request.route.path}`;
      }
    }
    return next.handle();
  }
}
