import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CLOSE_DAY_BATCH_SIZE } from '../../application/use-cases/update-reservation/ports/in/close-day.port.js';
import type { EnvironmentVariables } from './env.validation.js';

/**
 * Entrega `CLOSE_DAY_BATCH_SIZE` (plan de `update-reservation`, "Configuración"; por defecto `100`) desde la
 * configuración validada. Es global: `CloseDay` lo inyecta sin importarlo, como `SIRE_CONFIG` de
 * `SireConfigModule`.
 */
@Global()
@Module({
  providers: [
    {
      provide: CLOSE_DAY_BATCH_SIZE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) =>
        config.get('CLOSE_DAY_BATCH_SIZE', { infer: true }),
    },
  ],
  exports: [CLOSE_DAY_BATCH_SIZE],
})
export class CloseDayConfigModule {}
