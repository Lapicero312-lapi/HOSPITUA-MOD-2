import { HttpModule } from '@nestjs/axios';
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MODULE1_PORT } from '../../../application/ports/out/module1.port.js';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { Module1HttpAdapter } from './module1-http.adapter.js';

/**
 * Une `Module1Port` con su cliente HTTP (plan base, regla 4), con la dirección `MODULE1_BASE_URL` y el
 * tiempo máximo de espera de 1 s (`MODULE1_TIMEOUT_MS`). Es global: los casos de uso inyectan
 * `@Inject(MODULE1_PORT)` sin importarlo.
 */
@Global()
@Module({
  imports: [
    HttpModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) => ({
        baseURL: config.get('MODULE1_BASE_URL', { infer: true }),
        timeout: config.get('MODULE1_TIMEOUT_MS', { infer: true }),
      }),
    }),
  ],
  providers: [{ provide: MODULE1_PORT, useClass: Module1HttpAdapter }],
  exports: [MODULE1_PORT],
})
export class Module1ClientModule {}
