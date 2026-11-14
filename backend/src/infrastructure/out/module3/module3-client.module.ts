import { HttpModule } from '@nestjs/axios';
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MODULE3_PORT } from '../../../application/ports/out/module3.port.js';
import { QUOTE_CONCURRENCY } from '../../../application/use-cases/calculate-dynamic-rate/ports/in/calculate-dynamic-rate.port.js';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { Module3HttpAdapter } from './module3-http.adapter.js';

/**
 * Une `Module3Port` con su cliente HTTP (plan base, regla 4), con la dirección `MODULE3_BASE_URL` y el
 * tiempo máximo de espera de 3 s (`MODULE3_TIMEOUT_MS`). También entrega `QUOTE_CONCURRENCY`, el tope de
 * cotizaciones en paralelo al Módulo 3, desde la configuración validada. Es global: los casos de uso
 * inyectan `@Inject(MODULE3_PORT)` y `@Inject(QUOTE_CONCURRENCY)` sin importarlo.
 */
@Global()
@Module({
  imports: [
    HttpModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) => ({
        baseURL: config.get('MODULE3_BASE_URL', { infer: true }),
        timeout: config.get('MODULE3_TIMEOUT_MS', { infer: true }),
      }),
    }),
  ],
  providers: [
    { provide: MODULE3_PORT, useClass: Module3HttpAdapter },
    {
      provide: QUOTE_CONCURRENCY,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) =>
        config.get('QUOTE_CONCURRENCY', { infer: true }),
    },
  ],
  exports: [MODULE3_PORT, QUOTE_CONCURRENCY],
})
export class Module3ClientModule {}
