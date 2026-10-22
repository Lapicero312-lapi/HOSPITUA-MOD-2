import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { pinoHttpOptions } from './logging.options.js';
import { RoutePatternInterceptor } from './route-pattern.interceptor.js';

/**
 * Logs en JSON con nestjs-pino y un `correlationId` por solicitud, que la respuesta devuelve en
 * `X-Correlation-Id` (plan base, "Logs y correlación"). El nivel sale de `LOG_LEVEL`.
 */
@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        pinoHttp: pinoHttpOptions(config.getOrThrow<string>('LOG_LEVEL')),
      }),
    }),
  ],
  providers: [{ provide: APP_INTERCEPTOR, useClass: RoutePatternInterceptor }],
})
export class LoggingModule {}
