import { HttpModule } from '@nestjs/axios';
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MODULE1_PORT } from '../../../application/ports/out/module1.port.js';
import { MAINTENANCE_CONCURRENCY } from '../../../application/use-cases/consult-room-inventory/ports/in/list-rooms-with-maintenance.port.js';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { Module1HttpAdapter } from './module1-http.adapter.js';

/**
 * Une `Module1Port` con su cliente HTTP (plan base, regla 4), con la dirección `MODULE1_BASE_URL` y el
 * tiempo máximo de espera de 1 s (`MODULE1_TIMEOUT_MS`). También entrega `MAINTENANCE_CONCURRENCY`, el
 * tope de consultas de mantenimiento en paralelo al Módulo 1 de la pantalla "Habitaciones", desde la
 * configuración validada. Es global: los casos de uso inyectan `@Inject(MODULE1_PORT)` y
 * `@Inject(MAINTENANCE_CONCURRENCY)` sin importarlo.
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
  providers: [
    { provide: MODULE1_PORT, useClass: Module1HttpAdapter },
    {
      provide: MAINTENANCE_CONCURRENCY,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) =>
        config.get('MAINTENANCE_CONCURRENCY', { infer: true }),
    },
  ],
  exports: [MODULE1_PORT, MAINTENANCE_CONCURRENCY],
})
export class Module1ClientModule {}
