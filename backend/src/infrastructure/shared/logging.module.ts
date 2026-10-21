import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';

const CABECERA_DE_CORRELACION = 'x-correlation-id';
const FORMATO_DE_CORRELACION = /^[\w-]{1,100}$/;

/**
 * Logs en JSON con nestjs-pino. Cada solicitud HTTP lleva un `correlationId` (el de la cabecera
 * `X-Correlation-Id` si llega y es válido; si no, uno nuevo), que nestjs-pino guarda con
 * AsyncLocalStorage: todo log escrito durante la solicitud lo incluye, y la respuesta lo devuelve.
 *
 * No se escriben datos personales: de la solicitud solo se registran el método y la ruta, sin
 * cabeceras (`X-User`) ni parámetros de consulta.
 */
@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        pinoHttp: {
          level: config.getOrThrow<string>('LOG_LEVEL'),
          genReqId: (req, res) => {
            const recibido = req.headers[CABECERA_DE_CORRELACION];
            const correlationId =
              typeof recibido === 'string' &&
              FORMATO_DE_CORRELACION.test(recibido)
                ? recibido
                : randomUUID();
            res.setHeader(CABECERA_DE_CORRELACION, correlationId);
            return correlationId;
          },
          customAttributeKeys: { reqId: 'correlationId' },
          quietReqLogger: true,
          serializers: {
            req: (req: { method: string; url: string }) => ({
              method: req.method,
              url: req.url.split('?')[0],
            }),
            res: (res: { statusCode: number }) => ({
              statusCode: res.statusCode,
            }),
          },
        },
      }),
    }),
  ],
})
export class LoggingModule {}
